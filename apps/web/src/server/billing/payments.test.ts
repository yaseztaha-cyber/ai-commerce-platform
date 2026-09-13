import { describe, expect, it, afterAll } from "vitest";
import { createHash } from "crypto";
import { prisma } from "@ai-commerce/database";
import { FawryProvider, handleFawryCallback, resolvePaymentProvider, runRenewals, startCheckout, type PaymentProvider } from "./payments";

function sha256Hex(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

const SANDBOX = new FawryProvider({ merchantCode: "MC123", secureKey: "SECRET999", sandbox: true });

class FakeProvider implements PaymentProvider {
  readonly name = "Fawry";
  async createCheckout() {
    return { url: "https://pay.test/checkout" };
  }
  verifyCallback(bodyMap: Record<string, string>, signature: string): boolean {
    return SANDBOX.verifyCallback(bodyMap, signature);
  }
  parseCallback(bodyMap: Record<string, string>) {
    return SANDBOX.parseCallback(bodyMap);
  }
  async syncStatus() {
    return { paid: false, statusCode: 0 };
  }
}

const FAKE = new FakeProvider();

function paidCallback(ref: string) {
  const body = { merchantCode: "MC123", merchantRefNumber: ref, fawryRefNumber: `Fawry${ref}`, amount: "499", statusCode: "200", statusDescription: "Success" };
  const sig = sha256Hex("MC123" + ref + `Fawry${ref}` + "499" + "SECRET999");
  return { body, sig };
}

describe("Fawry signature construction", () => {
  it("matches expected SHA-256 for known inputs", () => {
    const ref = "ABC-1";
    const phone = "01000000000";
    const amount = 499;
    const items = [{ itemId: "sub_001", description: "Growth plan", price: 499, quantity: 1 }];
    let s = "MC123" + ref + phone + String(amount);
    for (const item of items) s += item.itemId + item.description + String(item.price) + String(item.quantity);
    s += "SECRET999";
    const expected = sha256Hex(s);
    const actual = (SANDBOX as any).buildInitSignature(ref, phone, amount, items);
    expect(actual).toBe(expected);
  });
});

describe("verifyCallback", () => {
  it("returns false when secureKey is missing (fail closed)", () => {
    const noKey = new FawryProvider({ merchantCode: "MC", secureKey: "", sandbox: true });
    const sig = sha256Hex("MCREF123Fawry123456amount999");
    expect(noKey.verifyCallback({ merchantCode: "MC", merchantRefNumber: "REF123", fawryRefNumber: "Fawry123456", amount: "999" }, sig)).toBe(false);
  });

  it("returns false for wrong signature", () => {
    expect(SANDBOX.verifyCallback(
      { merchantCode: "MC123", merchantRefNumber: "R1", fawryRefNumber: "F1", amount: "100" },
      "aaaa"
    )).toBe(false);
  });

  it("returns true for correct signature", () => {
    const body = { merchantCode: "MC123", merchantRefNumber: "R1", fawryRefNumber: "F1", amount: "100" };
    const sig = sha256Hex("MC123" + "R1" + "F1" + "100" + "SECRET999");
    expect(SANDBOX.verifyCallback(body, sig)).toBe(true);
  });

  it("returns false when a required field is missing", () => {
    const body = { merchantCode: "MC123", merchantRefNumber: "R1", fawryRefNumber: "", amount: "100" };
    const sig = sha256Hex("MC123R1F1100SECRET999");
    expect(SANDBOX.verifyCallback(body, sig)).toBe(false);
  });

  it("rejects a correctly-signed callback for a different merchant", () => {
    const body = { merchantCode: "OTHER", merchantRefNumber: "R1", fawryRefNumber: "F1", amount: "100" };
    const sig = sha256Hex("OTHER" + "R1" + "F1" + "100" + "SECRET999");
    expect(SANDBOX.verifyCallback(body, sig)).toBe(false);
  });
});

describe("parseCallback", () => {
  it("returns paid event for statusCode 200", () => {
    const evt = SANDBOX.parseCallback({
      merchantRefNumber: "REF",
      fawryRefNumber: "FAW",
      statusCode: "200",
      statusDescription: "Success",
      amount: "499",
    });
    expect(evt.statusCode).toBe(200);
    expect(evt.paidAt).toBeInstanceOf(Date);
    expect(evt.amount).toBe(499);
  });

  it("returns unpaid event for non-200", () => {
    const evt = SANDBOX.parseCallback({
      merchantRefNumber: "REF",
      fawryRefNumber: "FAW",
      statusCode: "401",
      statusDescription: "Failed",
      amount: "100",
    });
    expect(evt.statusCode).toBe(401);
    expect(evt.paidAt).toBeNull();
  });
});

describe("createCheckout + syncStatus (unit)", () => {
  it("createCheckout throws on network error (no real Fawry in test)", async () => {
    await expect(
      SANDBOX.createCheckout("REF-X", 100, { email: "test@test.com", phone: "01000000000" })
    ).rejects.toThrow();
  });
});

describe("paymentProvider selection (unit)", () => {
  it("resolves Fawry only when fully configured", () => {
    const full = resolvePaymentProvider({ merchantCode: "MC", secureKey: "SK", sandbox: true });
    expect(full?.name).toBe("Fawry");
    expect(resolvePaymentProvider({ merchantCode: "", secureKey: "SK", sandbox: true })).toBeNull();
    expect(resolvePaymentProvider({ merchantCode: "MC", secureKey: "", sandbox: true })).toBeNull();
    expect(resolvePaymentProvider({ merchantCode: "", secureKey: "", sandbox: true })).toBeNull();
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("Fawry callback flow (db)", () => {
  let tenantId = "";
  let subId = "";
  let subRef = "";
  let retryTenantId = "";
  let retrySubId = "";

  afterAll(async () => {
    if (subId) await prisma.subscription.delete({ where: { id: subId } }).catch(() => {});
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    if (retrySubId) await prisma.subscription.delete({ where: { id: retrySubId } }).catch(() => {});
    if (retryTenantId) await prisma.tenant.delete({ where: { id: retryTenantId } }).catch(() => {});
  });

  it("marks a subscription paid, then ignores the duplicate callback", async () => {
    const t = await prisma.tenant.create({ data: { slug: `fawry-${Date.now()}`, name: "Fawry Fixture" } });
    tenantId = t.id;
    await prisma.plan.upsert({ where: { slug: "growth" }, update: { priceEgp: 499 }, create: { slug: "growth", name: "Growth", priceEgp: 499, maxAiMessages: 5000, maxProducts: 500, maxSeats: 5, maxDocuments: 200, maxChannels: 5 } });
    const growth = await prisma.plan.findUniqueOrThrow({ where: { slug: "growth" } });
    const sub = await prisma.subscription.create({
      data: { tenantId, planId: growth.id, status: "PAST_DUE", provider: "Fawry", providerRef: "REF-UNIQUE-1", providerCustomerToken: "tok_1" },
    });
    subId = sub.id;
    subRef = sub.providerRef!;

    const { body, sig } = paidCallback(subRef);
    const first = await handleFawryCallback(body, sig, SANDBOX);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.event.statusCode).toBe(200);
      expect(first.event.paidAt).toBeInstanceOf(Date);
    }
    const updated = await prisma.subscription.findUniqueOrThrow({ where: { id: subId } });
    expect(updated.status).toBe("ACTIVE");
    expect(updated.currentPeriodEnd).toBeInstanceOf(Date);

    const second = await handleFawryCallback(body, sig, SANDBOX);
    expect(second.ok).toBe(true);
    const afterDup = await prisma.subscription.findUniqueOrThrow({ where: { id: subId } });
    expect(afterDup.lastProviderEvent?.getTime()).toBe(updated.lastProviderEvent?.getTime());
  });

  it("rejects a callback with an invalid signature (fail closed)", async () => {
    const body = { merchantCode: "MC123", merchantRefNumber: subRef, fawryRefNumber: "X", amount: "499" };
    const res = await handleFawryCallback(body, "0123456789abcdef", SANDBOX);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("signature_invalid");
  });

  it("returns unknown_subscription for a ref we never issued", async () => {
    const { body, sig } = paidCallback("NO-SUCH-REF");
    const res = await handleFawryCallback(body, sig, SANDBOX);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("unknown_subscription");
  });

  it("a retry after a failed trial payment is processed (not mistaken for a duplicate)", async () => {
    const t = await prisma.tenant.create({ data: { slug: `fawry-retry-${Date.now()}`, name: "Fawry Retry Fixture" } });
    retryTenantId = t.id;
    const growth = await prisma.plan.findUniqueOrThrow({ where: { slug: "growth" } });
    const trialEnd = new Date(Date.now() + 7 * 86400_000);
    const sub = await prisma.subscription.create({
      data: {
        tenantId: retryTenantId, planId: growth.id, status: "ACTIVE", provider: "Fawry",
        providerRef: "REF-RETRY-OLD", lastProviderEvent: new Date(), trialEndsAt: trialEnd,
      },
    });
    retrySubId = sub.id;

    const started = await startCheckout(
      { tenantId: retryTenantId, planSlug: "growth", owner: { userId: "u1", email: "o@test.com", phone: "01000000000" } },
      FAKE
    );
    expect("url" in started && started.url).toBe("https://pay.test/checkout");
    const re = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(re.providerRef).not.toBe("REF-RETRY-OLD");
    expect(re.lastProviderEvent).toBeNull();
    expect(re.trialEndsAt?.getTime()).toBe(trialEnd.getTime());

    const { body, sig } = paidCallback(re.providerRef!);
    const paid = await handleFawryCallback(body, sig, SANDBOX);
    expect(paid.ok).toBe(true);
    const done = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(done.status).toBe("ACTIVE");
    expect(done.currentPeriodEnd).toBeInstanceOf(Date);
  });
});

describe.skipIf(!hasDb)("subscription renewals (db)", () => {
  const tenants: string[] = [];
  const users: string[] = [];

  afterAll(async () => {
    for (const id of tenants) await prisma.tenant.delete({ where: { id } }).catch(() => {});
    for (const id of users) await prisma.user.delete({ where: { id } }).catch(() => {});
  });

  async function fixture(slug: string, sub: { status: string; providerRef: string | null; currentPeriodEnd: Date | null; trialEndsAt: Date | null }) {
    const t = await prisma.tenant.create({ data: { slug: `${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: "Renew Fixture" } });
    tenants.push(t.id);
    const u = await prisma.user.create({ data: { email: `${t.id}@test.com`, passwordHash: "x" } });
    users.push(u.id);
    await prisma.membership.create({ data: { tenantId: t.id, userId: u.id, role: "OWNER" } });
    const growth = await prisma.plan.findUniqueOrThrow({ where: { slug: "growth" } });
    return prisma.subscription.create({ data: { tenantId: t.id, planId: growth.id, provider: "Fawry", ...sub } });
  }

  it("past-due subs with no trial are picked up; live trials and current periods are not", async () => {
    const past = new Date(Date.now() - 86400_000);
    const future = new Date(Date.now() + 86400_000);
    const expired = await fixture("renew-expired", { status: "ACTIVE", providerRef: "REF-REN-1", currentPeriodEnd: past, trialEndsAt: null });
    const onTrial = await fixture("renew-trial", { status: "ACTIVE", providerRef: "REF-REN-2", currentPeriodEnd: past, trialEndsAt: future });
    const current = await fixture("renew-current", { status: "ACTIVE", providerRef: "REF-REN-3", currentPeriodEnd: future, trialEndsAt: null });
    const noRef = await fixture("renew-noref", { status: "ACTIVE", providerRef: null, currentPeriodEnd: past, trialEndsAt: null });

    const processed = await runRenewals();
    expect(processed).toBeGreaterThanOrEqual(1);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: expired.id } })).status).toBe("PAST_DUE");
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: onTrial.id } })).status).toBe("ACTIVE");
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: current.id } })).status).toBe("ACTIVE");
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: noRef.id } })).status).toBe("ACTIVE");
  });
});
