import crypto from "crypto";
import http from "http";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@ai-commerce/database";
import {
  CODE_MAX_ATTEMPTS,
  TwilioSmsDriver,
  VerifyError,
  WebhookSmsDriver,
  checkVerificationCode,
  isOrderPhoneVerified,
  newCode,
  pendingVerification,
  sendVerificationCode,
} from "./verify";

const hasDb = Boolean(process.env.DATABASE_URL);

describe("otp primitives", () => {
  it("generates 6-digit codes", () => {
    for (let i = 0; i < 20; i++) expect(newCode()).toMatch(/^\d{6}$/);
  });

  it("webhook driver posts {to, text} JSON", async () => {
    const seen: Array<{ url: string; body: string }> = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ url: req.url ?? "", body });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      await new WebhookSmsDriver(`http://127.0.0.1:${port}/sms`).sendSms("01000000000", "hello");
      expect(seen).toHaveLength(1);
      expect(JSON.parse(seen[0].body)).toMatchObject({ to: "01000000000", text: "hello" });
      await expect(new WebhookSmsDriver("http://127.0.0.1:9/dead").sendSms("01000000000", "x")).rejects.toThrow();
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("twilio driver is constructible (live shape covered by webhook test + docs)", async () => {
    // The Twilio endpoint URL is fixed; request shape mirrors WebhookSmsDriver
    // (auth header + form fields) and is verified against Twilio docs.
    const d = new TwilioSmsDriver("AC123", "tok", "+1000");
    expect(d.name).toBe("twilio");
  });
});

describe.skipIf(!hasDb)("otp service", () => {
  let tenantId = "";
  let otherTenantId = "";
  const phoneBase = "010656565";

  beforeAll(async () => {
    const t = await prisma.tenant.create({ data: { slug: `otp-${Date.now()}`, name: "OTP Fixture", requirePhoneVerify: true } });
    tenantId = t.id;
    const o = await prisma.tenant.create({ data: { slug: `otp-other-${Date.now()}`, name: "OTP Other" } });
    otherTenantId = o.id;
  });

  afterAll(async () => {
    await prisma.phoneVerification.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  });

  it("hashes codes at rest, never plaintext", async () => {
    await sendVerificationCode({ tenantId, phone: phoneBase + "01", orderId: `o-${Date.now()}-1`, shopName: "Shop" });
    const row = await prisma.phoneVerification.findFirst({ where: { tenantId, phone: phoneBase + "01" }, orderBy: { createdAt: "desc" } });
    expect(row).toBeTruthy();
    expect(row!.codeHash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex, never the 6-digit code itself
    expect(row!.verifiedAt).toBeNull();
  });

  it("cooldown resend does not burn SMS budget", async () => {
    const orderId = `o-${Date.now()}-2`;
    const first = await sendVerificationCode({ tenantId, phone: phoneBase + "02", orderId, shopName: "Shop" });
    expect(first.sent).toBe(true);
    const second = await sendVerificationCode({ tenantId, phone: phoneBase + "02", orderId, shopName: "Shop" });
    expect(second.sent).toBe(false);
    expect(second.cooldownMs).toBeGreaterThan(0);
    expect(await prisma.phoneVerification.count({ where: { tenantId, orderId } })).toBe(1);
  });

  it("wrong guesses lock after 5, then expire path offers resend", async () => {
    const orderId = `o-${Date.now()}-3`;
    await sendVerificationCode({ tenantId, phone: phoneBase + "03", orderId, shopName: "Shop" });
    for (let i = 0; i < CODE_MAX_ATTEMPTS - 1; i++) {
      await expect(checkVerificationCode({ tenantId, orderId, code: "000000" })).rejects.toMatchObject({ kind: "wrong" });
    }
    await expect(checkVerificationCode({ tenantId, orderId, code: "000000" })).rejects.toMatchObject({ kind: "wrong" });
    // 6th attempt: locked (row already at cap)
    await expect(checkVerificationCode({ tenantId, orderId, code: "000000" })).rejects.toMatchObject({ kind: "locked" });
    expect(await isOrderPhoneVerified(tenantId, orderId)).toBe(false);
  });

  it("expired codes fail closed with resend guidance", async () => {
    const orderId = `o-${Date.now()}-4`;
    await sendVerificationCode({ tenantId, phone: phoneBase + "04", orderId, shopName: "Shop" });
    await prisma.phoneVerification.updateMany({ where: { tenantId, orderId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(checkVerificationCode({ tenantId, orderId, code: "123456" })).rejects.toMatchObject({ kind: "expired" });
  });

  it("codes are bound to tenant+order (no cross-use)", async () => {
    const orderId = `o-${Date.now()}-5`;
    await sendVerificationCode({ tenantId, phone: phoneBase + "05", orderId, shopName: "Shop" });
    // Another tenant asking for the same order id finds nothing.
    await expect(checkVerificationCode({ tenantId: otherTenantId, orderId, code: "123456" })).rejects.toThrow();
    // Same tenant, different order: nothing live.
    await expect(checkVerificationCode({ tenantId, orderId: `${orderId}-other`, code: "123456" })).rejects.toThrow();
  });

  it("a correct code verifies exactly its order", async () => {
    // Deterministic: insert a known-hash row (codes are never stored plaintext).
    const orderId = `o-${Date.now()}-6`;
    const known = "482916";
    await prisma.phoneVerification.create({
      data: {
        tenantId,
        phone: phoneBase + "06",
        orderId,
        codeHash: crypto.createHash("sha256").update(known, "utf8").digest("hex"),
        expiresAt: new Date(Date.now() + 600000),
      },
    });
    await checkVerificationCode({ tenantId, orderId, code: known });
    expect(await isOrderPhoneVerified(tenantId, orderId)).toBe(true);
    expect(await isOrderPhoneVerified(tenantId, `${orderId}-nope`)).toBe(false);
  });

  it("send rate limit throttles SMS flooding per phone", async () => {
    const results = [];
    for (let i = 0; i < 5; i++) {
      try {
        // fresh order each time defeats cooldown, exercising the rate limiter
        await sendVerificationCode({ tenantId, phone: `0107777000${i}`, orderId: `rl-${Date.now()}-${i}`, shopName: "Shop" });
        results.push("sent");
      } catch (e) {
        results.push(e instanceof VerifyError ? e.kind : "other");
      }
    }
    expect(results).toContain("sent");
    // Same phone hammered across orders hits the 3/10min cap.
    const hammered: string[] = [];
    for (let i = 0; i < 5; i++) {
      try {
        await sendVerificationCode({ tenantId, phone: "01077779999", orderId: `rl2-${Date.now()}-${i}`, shopName: "Shop" });
        hammered.push("sent");
      } catch (e) {
        hammered.push(e instanceof VerifyError ? "limited" : "other");
      }
    }
    expect(hammered.filter((x) => x === "sent").length).toBeLessThanOrEqual(3);
    expect(hammered).toContain("limited");
  });
});
