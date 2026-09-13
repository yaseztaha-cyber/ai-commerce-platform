import { describe, expect, it, afterAll } from "vitest";
import { prisma } from "@ai-commerce/database";
import { checkLimit, currentPeriod, downgradePlan, getSubscription, meter, seatCountEnforced, usageForPeriod } from "./billing";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("billing limits + metering", () => {
  let tenantId = "";

  afterAll(async () => {
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  });

  it("provisions a starter subscription and meters backend usage", async () => {
    const t = await prisma.tenant.create({ data: { slug: `bill-${Date.now()}`, name: "Bill Fixture" } });
    tenantId = t.id;
    const sub = await getSubscription(tenantId);
    expect(sub.status).toBe("ACTIVE");
    expect(sub.plan.slug).toBe("starter");
    expect(sub.plan.priceEgp).toBe(0);
    const growth = await prisma.plan.findUniqueOrThrow({ where: { slug: "growth" } });
    const scale = await prisma.plan.findUniqueOrThrow({ where: { slug: "scale" } });
    expect(growth.priceEgp).toBe(499);
    expect(scale.priceEgp).toBe(1999);
    expect((await checkLimit(tenantId, "ai_run")).allowed).toBe(true);
    await meter(tenantId, "ai_run", 3);
    expect((await usageForPeriod(tenantId, currentPeriod())).ai_run).toBe(3);
  });

  it("blocks at the plan cap and for inactive subscriptions", async () => {
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { tenantId }, include: { plan: true } });
    await prisma.usageCounter.upsert({
      where: { tenantId_metric_period: { tenantId, metric: "ai_run", period: currentPeriod() } },
      update: { count: (sub.plan.maxAiMessages ?? 200) + 1 },
      create: { tenantId, metric: "ai_run", period: currentPeriod(), count: (sub.plan.maxAiMessages ?? 200) + 1 },
    });
    const blocked = await checkLimit(tenantId, "ai_run");
    expect(blocked.allowed).toBe(false);
    await prisma.subscription.update({ where: { tenantId }, data: { status: "SUSPENDED" } });
    expect((await checkLimit(tenantId, "ai_run")).allowed).toBe(false);
    expect((await checkLimit(tenantId, "document")).allowed).toBe(false);
    await prisma.subscription.update({ where: { tenantId }, data: { status: "ACTIVE" } });
  });
});

describe.skipIf(!hasDb)("plan downgrades + seat gate", () => {
  const tenants: string[] = [];
  const users: string[] = [];

  afterAll(async () => {
    for (const id of tenants) await prisma.tenant.delete({ where: { id } }).catch(() => {});
    for (const id of users) await prisma.user.delete({ where: { id } }).catch(() => {});
  });

  async function paidTenant(slug: string, planSlug: string, status = "ACTIVE") {
    const t = await prisma.tenant.create({ data: { slug: `${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: "Downgrade Fixture" } });
    tenants.push(t.id);
    const plan = await prisma.plan.findUniqueOrThrow({ where: { slug: planSlug } });
    await getSubscription(t.id);
    await prisma.subscription.update({
      where: { tenantId: t.id },
      data: { planId: plan.id, status, providerRef: "REF-DG-1", lastProviderEvent: new Date(), currentPeriodEnd: new Date(Date.now() + 86400_000) },
    });
    return t.id;
  }

  it("downgrades growth to starter: clears ref, period end, and past-due", async () => {
    const id = await paidTenant("dg-free", "growth", "PAST_DUE");
    const res = await downgradePlan(id, "starter", "user:test");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.subscription).toMatchObject({ status: "ACTIVE", plan: { slug: "starter" } });
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { tenantId: id } });
    expect(sub.providerRef).toBeNull();
    expect(sub.lastProviderEvent).toBeNull();
    expect(sub.currentPeriodEnd).toBeNull();
  });

  it("downgrades scale to growth keeping status, rejects same/up/invalid", async () => {
    const id = await paidTenant("dg-paid", "scale");
    const res = await downgradePlan(id, "growth", "user:test");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.subscription.plan.slug).toBe("growth");
    expect((await prisma.subscription.findUniqueOrThrow({ where: { tenantId: id } })).status).toBe("ACTIVE");
    expect(await downgradePlan(id, "growth", "user:test")).toMatchObject({ ok: false, error: "same_plan" });
    expect(await downgradePlan(id, "scale", "user:test")).toMatchObject({ ok: false, error: "not_downgrade" });
    expect(await downgradePlan(id, "nope", "user:test")).toMatchObject({ ok: false, error: "invalid_plan" });
  });

  it("blocks invites at the seat cap", async () => {
    const t = await prisma.tenant.create({ data: { slug: `dg-seats-${Date.now()}`, name: "Seat Fixture" } });
    tenants.push(t.id);
    await getSubscription(t.id); // starter: 2 seats
    expect((await seatCountEnforced(t.id)).allowed).toBe(true);
    for (let i = 0; i < 2; i++) {
      const u = await prisma.user.create({ data: { email: `seat-${t.id}-${i}@t.com`, passwordHash: "x" } });
      users.push(u.id);
      await prisma.membership.create({ data: { tenantId: t.id, userId: u.id, role: "AGENT" } });
    }
    const gate = await seatCountEnforced(t.id);
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.code).toBe("PLAN_LIMIT");
  });
});
