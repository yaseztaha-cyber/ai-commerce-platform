import { createHash, timingSafeEqual } from "crypto";
import { prisma } from "@ai-commerce/database";
import { config } from "@/lib/env";
import { logger } from "@/lib/logger";
import { audit } from "@/server/audit";
import { sendMail } from "@/server/email";
import { ensureDefaultPlans, getSubscription, usageForPeriod, currentPeriod, PLAN_LIST, PLAN_BY_SLUG } from "@/server/billing";

export interface CheckoutOptions {
  tenantId: string;
  planSlug: string;
  owner: { userId: string; email: string; phone?: string };
}

export interface CallbackEvent {
  merchantRefNumber: string;
  fawryRefNumber: string;
  statusCode: number;
  statusDescription: string;
  amount: number;
  paidAt: Date | null;
}

export interface PaymentProvider {
  readonly name: string;
  createCheckout(ref: string, amountEgp: number, opts: { email?: string; phone?: string; description?: string }): Promise<{ url: string }>;
  verifyCallback(bodyMap: Record<string, string>, signature: string): boolean;
  parseCallback(bodyMap: Record<string, string>): CallbackEvent;
  syncStatus(ref: string): Promise<{ paid: boolean; statusCode: number; fawryRefNumber?: string }>;
}

/* ─── Fawry implementation ────────────────────────────────────────────────── */

const FAWRY_SANDBOX_BASE = "https://atfawry.fawrybank.com:8443";
const FAWRY_PROD_BASE = "https://www.atfawry.com";
const RENEWAL_PERIOD_DAYS = 30;
const TRIAL_DAYS = 14;

function newProviderRef(tenantId: string): string {
  return `${tenantId.slice(-8)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function timingSafeHexCompare(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export class FawryProvider implements PaymentProvider {
  readonly name = "Fawry";
  private merchantCode: string;
  private secureKey: string;
  private baseUrl: string;

  constructor(opts: { merchantCode: string; secureKey: string; sandbox: boolean }) {
    this.merchantCode = opts.merchantCode;
    this.secureKey = opts.secureKey;
    this.baseUrl = opts.sandbox ? FAWRY_SANDBOX_BASE : FAWRY_PROD_BASE;
  }

  private buildInitSignature(ref: string, phone: string, amount: number, items: Array<{ itemId: string; description: string; price: number; quantity: number }>): string {
    let s = this.merchantCode + ref + phone + String(amount);
    for (const item of items) {
      s += item.itemId + item.description + String(item.price) + String(item.quantity);
    }
    s += this.secureKey;
    return sha256Hex(s);
  }

  async createCheckout(
    ref: string,
    amountEgp: number,
    opts: { email?: string; phone?: string; description?: string }
  ): Promise<{ url: string }> {
    const phone = opts.phone?.replace(/\D/g, "") || "0";
    const items = [{ itemId: "sub_001", description: opts.description ?? "YASEZ subscription", price: amountEgp, quantity: 1 }];
    const signature = this.buildInitSignature(ref, phone, amountEgp, items);

    const body = {
      merchantCode: this.merchantCode,
      merchantRefNum: ref,
      customerMobileNumber: phone,
      customerEmail: opts.email,
      paymentMethod: "CARD",
      amount: amountEgp,
      currencyCode: "EGP",
      description: opts.description ?? "YASEZ Commerce subscription",
      chargeItems: items,
      signature,
    };

    const res = await fetch(`${this.baseUrl}/fawrypay-api/api/payments/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.error("Fawry init request failed", { ref, status: res.status, body: text.slice(0, 400) });
      throw new Error(`Fawry ${res.status}`);
    }
    const data = (await res.json()) as { statusCode?: number; paymentURL?: string; statusDescription?: string };
    if (data.statusCode !== 200 || !data.paymentURL) {
      logger.error("Fawry init rejected", { ref, statusCode: data.statusCode, desc: data.statusDescription });
      throw new Error(data.statusDescription ?? "Fawry init failed");
    }
    return { url: data.paymentURL };
  }

  verifyCallback(bodyMap: Record<string, string>, signature: string): boolean {
    if (!this.secureKey) {
      logger.warn("Fawry callback secret not configured — rejecting (fail closed)");
      return false;
    }
    const { merchantCode, merchantRefNumber, fawryRefNumber, amount } = bodyMap;
    if (!merchantCode || merchantCode !== this.merchantCode || !merchantRefNumber || !fawryRefNumber || !amount || !signature) return false;
    const expected = sha256Hex(merchantCode + merchantRefNumber + fawryRefNumber + amount + this.secureKey);
    return timingSafeHexCompare(expected, signature);
  }

  parseCallback(bodyMap: Record<string, string>): CallbackEvent {
    const statusCode = Number(bodyMap.statusCode ?? "0");
    return {
      merchantRefNumber: bodyMap.merchantRefNumber ?? "",
      fawryRefNumber: bodyMap.fawryRefNumber ?? "",
      statusCode,
      statusDescription: bodyMap.statusDescription ?? "",
      amount: Number(bodyMap.amount ?? "0"),
      paidAt: statusCode === 200 ? new Date() : null,
    };
  }

  async syncStatus(ref: string): Promise<{ paid: boolean; statusCode: number; fawryRefNumber?: string }> {
    if (!this.secureKey) return { paid: false, statusCode: 0 };
    const signature = sha256Hex(this.merchantCode + ref + this.secureKey);
    try {
      const res = await fetch(`${this.baseUrl}/fawrypay-api/api/payments/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantCode: this.merchantCode, merchantRefNumber: ref, signature }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return { paid: false, statusCode: 0 };
      const data = (await res.json()) as { statusCode?: number; fawryRefNumber?: string };
      return { paid: data.statusCode === 200, statusCode: data.statusCode ?? 0, fawryRefNumber: data.fawryRefNumber };
    } catch {
      return { paid: false, statusCode: 0 };
    }
  }
}

/* ─── Provider selection ───────────────────────────────────────────────────── */

let cachedProvider: PaymentProvider | null = null;
let providerResolved = false;

export function resolvePaymentProvider(cfg: { merchantCode: string; secureKey: string; sandbox: boolean }): PaymentProvider | null {
  if (cfg.merchantCode && cfg.secureKey) return new FawryProvider(cfg);
  return null;
}

export function paymentProvider(): PaymentProvider | null {
  if (providerResolved) return cachedProvider;
  providerResolved = true;
  cachedProvider = resolvePaymentProvider({ merchantCode: config.fawry.merchantCode, secureKey: config.fawry.secureKey, sandbox: config.fawry.sandbox });
  if (cachedProvider) logger.info("Fawry payment provider enabled", { sandbox: config.fawry.sandbox });
  else logger.info("Billing disabled (FAWRY_MERCHANT_CODE / FAWRY_SECURE_KEY not set)");
  return cachedProvider;
}

/** Test hook: drop the cached provider so config changes take effect. */
export function resetPaymentProviderForTest(): void {
  cachedProvider = null;
  providerResolved = false;
}

/* ─── Checkout orchestration ───────────────────────────────────────────────── */

export async function startCheckout(
  opts: CheckoutOptions,
  override?: PaymentProvider
): Promise<{ url: string } | { url: null; error: string }> {
  const provider = override ?? paymentProvider();
  if (!provider) return { url: null, error: "billing_not_configured" };

  await ensureDefaultPlans();
  const planDef = PLAN_BY_SLUG[opts.planSlug];
  if (!planDef || (planDef.priceEgp ?? 0) <= 0) return { url: null, error: "invalid_plan" };

  const sub = await getSubscription(opts.tenantId);
  // New ref = new payment attempt: clear the old event marker or a later
  // paid callback would be mistaken for a duplicate. Trial is once-ever:
  // re-initiating checkout must not extend it without payment.
  const ref = newProviderRef(opts.tenantId);
  await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      provider: provider.name,
      providerRef: ref,
      currentPeriodStart: new Date(),
      lastProviderEvent: null,
      trialEndsAt: sub.trialEndsAt ?? (opts.owner.phone ? new Date(Date.now() + TRIAL_DAYS * 86400_000) : null),
    },
  });
  await audit({ tenantId: opts.tenantId, actor: `user:${opts.owner.userId}`, action: "billing.checkout_started", resource: "subscription", resourceId: sub.id, newValue: { ref, plan: opts.planSlug } });
  return provider.createCheckout(ref, planDef.priceEgp, { email: opts.owner.email, phone: opts.owner.phone, description: `YASEZ ${planDef.name} plan` });
}

/* ─── Callback orchestration (fail-closed, idempotent) ─────────────────────── */

export async function handleFawryCallback(
  bodyMap: Record<string, string>,
  signature: string,
  override?: PaymentProvider
): Promise<{ ok: true; event: CallbackEvent } | { ok: false; reason: string }> {
  const provider = override ?? paymentProvider();
  if (!provider) return { ok: false, reason: "provider_not_configured" };
  if (!provider.verifyCallback(bodyMap, signature)) {
    logger.warn("Fawry callback signature invalid (fail closed)");
    return { ok: false, reason: "signature_invalid" };
  }

  const event = provider.parseCallback(bodyMap);
  if (!event.merchantRefNumber) return { ok: false, reason: "missing_ref" };

  const sub = await prisma.subscription.findFirst({ where: { providerRef: event.merchantRefNumber }, include: { plan: true } });
  if (!sub) {
    logger.warn("Fawry callback for unknown ref", { ref: event.merchantRefNumber });
    return { ok: false, reason: "unknown_subscription" };
  }

  // Idempotent: if the event was already recorded for this ref, ignore.
  if (sub.lastProviderEvent && sub.status !== "PAST_DUE") {
    logger.info("duplicate Fawry callback ignored", { ref: event.merchantRefNumber });
    return { ok: true, event };
  }

  const now = new Date();
  if (event.statusCode === 200) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        status: "ACTIVE",
        currentPeriodEnd: new Date(now.getTime() + RENEWAL_PERIOD_DAYS * 86400_000),
        lastProviderEvent: now,
      },
    });
    await audit({ tenantId: sub.tenantId, actor: "system", action: "billing.payment_succeeded", resource: "subscription", resourceId: sub.id, newValue: { fawryRefNumber: event.fawryRefNumber, amount: event.amount } });
  } else {
    const newStatus = sub.trialEndsAt && sub.trialEndsAt > now ? "ACTIVE" : "PAST_DUE";
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: newStatus, lastProviderEvent: now } });
    await audit({ tenantId: sub.tenantId, actor: "system", action: "billing.payment_failed", resource: "subscription", resourceId: sub.id, newValue: { statusCode: event.statusCode, desc: event.statusDescription } });
  }
  return { ok: true, event };
}

/* ─── Status ───────────────────────────────────────────────────────────────── */

export async function billingStatus(tenantId: string) {
  await ensureDefaultPlans();
  const sub = await getSubscription(tenantId);
  const usage = await usageForPeriod(tenantId);
  const provider = paymentProvider();

  let providerStatus: { synced: boolean; paid?: boolean } = { synced: false };
  if (provider && sub.providerRef && sub.status !== "ACTIVE") {
    providerStatus = { synced: true, ...(await provider.syncStatus(sub.providerRef)) };
  }

  return {
    subscription: {
      status: sub.status,
      plan: {
        slug: sub.plan.slug,
        name: sub.plan.name,
        priceEgp: sub.plan.priceEgp ?? 0,
        maxAiMessages: sub.plan.maxAiMessages,
        maxProducts: sub.plan.maxProducts,
        maxSeats: sub.plan.maxSeats,
        maxDocuments: sub.plan.maxDocuments,
      },
    },
    usage: {
      period: currentPeriod(),
      messages: usage.message ?? 0,
      aiRuns: usage.ai_run ?? 0,
      documents: usage.document ?? 0,
      products: await prisma.product.count({ where: { tenantId, active: true } }),
      seats: await prisma.membership.count({ where: { tenantId } }),
    },
    trialEndsAt: sub.trialEndsAt,
    currentPeriodEnd: sub.currentPeriodEnd,
    providerStatus,
    plans: PLAN_LIST,
  };
}

/* ─── Renewal cron helper (called by /api/cron/renew-subscriptions) ─────────── */

export async function runRenewals(): Promise<number> {
  const provider = paymentProvider();
  const now = new Date();
  // NULL trialEndsAt (never trialed / paid before) counts as expired here.
  const due = await prisma.subscription.findMany({
    where: {
      status: "ACTIVE",
      providerRef: { not: null },
      currentPeriodEnd: { lt: now },
      OR: [{ trialEndsAt: null }, { trialEndsAt: { lt: now } }],
    },
    include: { plan: true },
  });
  let processed = 0;
  for (const sub of due) {
    try {
      // Server-side charging is impossible without stored card tokens, so a
      // fresh checkout link goes to the owner and the sub moves to PAST_DUE
      // (grace handled by the dashboard banner, not by silent ACTIVE).
      let url: string | null = null;
      if (provider && (sub.plan.priceEgp ?? 0) > 0) {
        const ref = newProviderRef(sub.tenantId);
        await prisma.subscription.update({ where: { id: sub.id }, data: { providerRef: ref, lastProviderEvent: null } });
        try {
          url = (await provider.createCheckout(ref, sub.plan.priceEgp!, { description: `Renewal — ${sub.plan.name}` })).url;
        } catch (err) {
          logger.error("renewal checkout failed", { subscriptionId: sub.id, error: String(err) });
        }
      }
      const membership = await prisma.membership.findFirst({ where: { tenantId: sub.tenantId, role: "OWNER" } });
      const owner = membership ? await prisma.user.findUnique({ where: { id: membership.userId } }) : null;
      if (owner) {
        await sendMail({
          to: owner.email,
          subject: "Renew your YASEZ Commerce plan",
          text: `Your ${sub.plan.name} subscription has expired. Renew to continue using all features${url ? `: ${url}` : " from Dashboard → Billing"}.`,
        }).catch(() => {});
      }
      await prisma.subscription.update({ where: { id: sub.id }, data: { status: "PAST_DUE" } });
      await audit({ tenantId: sub.tenantId, actor: "system", action: "billing.renewal_due", resource: "subscription", resourceId: sub.id });
      processed++;
    } catch (err) {
      logger.error("renewal attempt failed", { subscriptionId: sub.id, error: String(err) });
    }
  }
  return processed;
}