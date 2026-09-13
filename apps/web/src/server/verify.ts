import crypto from "crypto";
import { prisma } from "@ai-commerce/database";
import { config } from "@/lib/env";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import { meter } from "./billing";

/**
 * COD fake-order protection (leak 7). One verified code per order: a code is
 * generated, SHA-256 hashed at rest, expires in 10 minutes, dies after 5
 * wrong attempts. Verification binds (tenant, phone, order) — never just
 * the phone, so each shipment is separately assured.
 */

export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60 * 1000;
export const SEND_RATE_WINDOW_MS = 10 * 60 * 1000;
export const SEND_RATE_MAX = 3;

export type VerifyErrorKind = "required" | "locked" | "expired" | "wrong" | "send_failed" | "not_found";

export class VerifyError extends Error {
  readonly kind: VerifyErrorKind;
  readonly attemptsLeft?: number;
  constructor(kind: VerifyErrorKind, message: string, attemptsLeft?: number) {
    super(message);
    this.name = "VerifyError";
    this.kind = kind;
    this.attemptsLeft = attemptsLeft;
  }
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code, "utf8").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function newCode(): string {
  return String(crypto.randomInt(100000, 1000000));
}

export interface SmsDriver {
  readonly name: string;
  sendSms(phone: string, text: string): Promise<void>;
}

/** Dev default: logs the code. Real deliveries need webhook/twilio drivers. */
export class LogSmsDriver implements SmsDriver {
  readonly name = "log";
  async sendSms(phone: string, text: string): Promise<void> {
    console.log(JSON.stringify({ kind: "verification_code", phone, text }));
  }
}

export class WebhookSmsDriver implements SmsDriver {
  readonly name = "webhook";
  constructor(private readonly url: string) {}
  async sendSms(phone: string, text: string): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(this.url, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: phone, text }),
      });
      if (!res.ok) throw new Error(`sms webhook ${res.status}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

export class TwilioSmsDriver implements SmsDriver {
  readonly name = "twilio";
  constructor(private readonly accountSid: string, private readonly authToken: string, private readonly from: string) {}
  async sendSms(phone: string, text: string): Promise<void> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: "Basic " + Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: phone, From: this.from, Body: text }),
      });
      if (!res.ok) throw new Error(`twilio ${res.status}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

function smsDriver(): SmsDriver {
  if (config.sms.twilioAccountSid && config.sms.twilioAuthToken && config.sms.twilioFrom) {
    return new TwilioSmsDriver(config.sms.twilioAccountSid, config.sms.twilioAuthToken, config.sms.twilioFrom);
  }
  if (config.sms.webhookUrl) return new WebhookSmsDriver(config.sms.webhookUrl);
  return new LogSmsDriver();
}

export function verificationMessage(code: string, shopName: string): string {
  return `كود تأكيد طلبك من ${shopName}: ${code} (صالح ١٠ دقايق)`;
}

/**
 * Issue (or re-issue) a code for an order. Resends within the cooldown
 * return the live code state without burning SMS budget.
 */
export async function sendVerificationCode(input: {
  tenantId: string;
  phone: string;
  orderId: string;
  shopName: string;
  driver?: SmsDriver;
}): Promise<{ sent: boolean; cooldownMs: number }> {
  const { tenantId, phone, orderId, shopName } = input;
  const now = new Date();
  const existing = await prisma.phoneVerification.findFirst({
    where: { tenantId, phone, orderId, verifiedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });
  if (existing && now.getTime() - existing.lastSentAt.getTime() < RESEND_COOLDOWN_MS) {
    return { sent: false, cooldownMs: RESEND_COOLDOWN_MS - (now.getTime() - existing.lastSentAt.getTime()) };
  }
  const rl = rateLimit(`otp:${tenantId}:${phone}`, SEND_RATE_MAX, SEND_RATE_WINDOW_MS);
  if (!rl.allowed) throw new VerifyError("send_failed", "Too many codes sent. Try again in a few minutes.");
  const code = newCode();
  const driver = input.driver ?? smsDriver();
  try {
    await driver.sendSms(phone, verificationMessage(code, shopName));
  } catch (err) {
    logger.error("verification sms failed", { tenantId, error: err instanceof Error ? err.message.slice(0, 200) : "sms failed" });
    throw new VerifyError("send_failed", "Could not send the code right now.");
  }
  await prisma.phoneVerification.create({
    data: { tenantId, phone, orderId, codeHash: hashCode(code), expiresAt: new Date(now.getTime() + CODE_TTL_MS), attempts: 0, lastSentAt: now },
  });
  void meter(tenantId, "verification");
  return { sent: true, cooldownMs: 0 };
}

/** Latest live (unverified, unexpired) code row for an order. */
export async function pendingVerification(tenantId: string, orderId: string) {
  return prisma.phoneVerification.findFirst({
    where: { tenantId, orderId, verifiedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
}

export async function isOrderPhoneVerified(tenantId: string, orderId: string): Promise<boolean> {
  const row = await prisma.phoneVerification.findFirst({ where: { tenantId, orderId, verifiedAt: { not: null } } });
  return row != null;
}

/**
 * Check a submitted code. Wrong guesses increment attempts (lock at 5);
 * expired rows fail closed. Returns silently on success (caller confirms).
 */
export async function checkVerificationCode(input: { tenantId: string; orderId: string; code: string }): Promise<void> {
  const row = await pendingVerification(input.tenantId, input.orderId);
  if (!row) {
    const any = await prisma.phoneVerification.findFirst({
      where: { tenantId: input.tenantId, orderId: input.orderId },
      orderBy: { createdAt: "desc" },
    });
    if (any && !any.verifiedAt) throw new VerifyError("expired", "The code expired. Say confirm again and I will send a fresh one.");
    throw new VerifyError("not_found", "No code was sent for this order yet.");
  }
  if (row.attempts >= CODE_MAX_ATTEMPTS) {
    throw new VerifyError("locked", "Too many wrong attempts. Say confirm again and I will send a fresh code.");
  }
  const guess = (input.code ?? "").trim();
  if (!/^\d{4,8}$/.test(guess) || !safeEqual(hashCode(guess), row.codeHash)) {
    const left = CODE_MAX_ATTEMPTS - (row.attempts + 1);
    await prisma.phoneVerification.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    throw new VerifyError("wrong", left > 0 ? `Wrong code. ${left} attempts left.` : "Too many wrong attempts. Say confirm again and I will send a fresh code.", Math.max(0, left));
  }
  await prisma.phoneVerification.update({ where: { id: row.id }, data: { verifiedAt: new Date() } });
}
