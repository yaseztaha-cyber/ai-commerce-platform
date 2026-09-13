import { prisma } from "@ai-commerce/database";
import { audit } from "@/server/audit";

/**
 * Billing preparation: plans, subscriptions, usage metering.
 * Limits are enforced HERE (service layer) — never trust client input.
 * No payment processing (fake billing is forbidden); this only meters
 * backend-derived usage and gates over-limit tenants.
 */

export type UsageMetric = "message" | "ai_run" | "tool_call" | "document" | "transcription" | "vision" | "verification";

export function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

const DEFAULT_PLANS = [
  { slug: "starter", name: "Starter", priceEgp: 0, maxAiMessages: 200, maxProducts: 50, maxSeats: 2, maxDocuments: 20, maxChannels: 2 },
  { slug: "growth", name: "Growth", priceEgp: 499, maxAiMessages: 5000, maxProducts: 500, maxSeats: 5, maxDocuments: 200, maxChannels: 5 },
  { slug: "scale", name: "Scale", priceEgp: 1999, maxAiMessages: null, maxProducts: null, maxSeats: null, maxDocuments: null, maxChannels: null },
];

export const PLAN_LIST = DEFAULT_PLANS.map((p) => ({
  slug: p.slug,
  name: p.name,
  priceEgp: p.priceEgp ?? 0,
  maxAiMessages: p.maxAiMessages,
  maxProducts: p.maxProducts,
  maxSeats: p.maxSeats,
  maxDocuments: p.maxDocuments,
  maxChannels: p.maxChannels,
}));
export const PLAN_BY_SLUG = Object.fromEntries(DEFAULT_PLANS.map((p) => [p.slug, p])) as Record<string, (typeof DEFAULT_PLANS)[number]>;

export async function ensureDefaultPlans() {
  for (const p of DEFAULT_PLANS) {
    await prisma.plan.upsert({ where: { slug: p.slug }, update: { ...p }, create: p });
  }
}

export async function getSubscription(tenantId: string) {
  await ensureDefaultPlans();
  let sub = await prisma.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
  if (!sub) {
    const starter = await prisma.plan.findUniqueOrThrow({ where: { slug: "starter" } });
    sub = await prisma.subscription.create({ data: { tenantId, planId: starter.id, status: "ACTIVE" }, include: { plan: true } });
  }
  return sub;
}

/** Backend-derived metering (never client-reported). */
export async function meter(tenantId: string, metric: UsageMetric, by = 1): Promise<void> {
  try {
    await prisma.usageCounter.upsert({
      where: { tenantId_metric_period: { tenantId, metric, period: currentPeriod() } },
      update: { count: { increment: by } },
      create: { tenantId, metric, period: currentPeriod(), count: by },
    });
  } catch {
    /* metering never breaks the main flow */
  }
}

export async function usageForPeriod(tenantId: string, period = currentPeriod()) {
  const rows = await prisma.usageCounter.findMany({ where: { tenantId, period } });
  return Object.fromEntries(rows.map((r) => [r.metric, r.count])) as Record<UsageMetric, number>;
}

const METRIC_TO_LIMIT: Record<"ai_run" | "document", "maxAiMessages" | "maxDocuments"> = {
  ai_run: "maxAiMessages",
  document: "maxDocuments",
};

/**
 * Returns {allowed:false} when the tenant's plan cap for this period is hit.
 * Suspended/cancelled subscriptions are blocked entirely.
 */
export async function checkLimit(
  tenantId: string,
  metric: "ai_run" | "document"
): Promise<{ allowed: true } | { allowed: false; code: string; message: string }> {
  const sub = await getSubscription(tenantId);
  if (sub.status !== "ACTIVE") {
    return { allowed: false, code: "SUBSCRIPTION_INACTIVE", message: `Subscription is ${sub.status}` };
  }
  const limitKey = METRIC_TO_LIMIT[metric];
  const limit = sub.plan[limitKey] as number | null;
  if (limit == null) return { allowed: true };
  const used = (await usageForPeriod(tenantId))[metric] ?? 0;
  if (used >= limit) {
    return { allowed: false, code: "PLAN_LIMIT", message: `${metric} limit reached (${used}/${limit} this period)` };
  }
  return { allowed: true };
}

export async function productCountEnforced(tenantId: string): Promise<{ allowed: true } | { allowed: false; code: string; message: string }> {
  const sub = await getSubscription(tenantId);
  if (sub.plan.maxProducts == null) return { allowed: true };
  const count = await prisma.product.count({ where: { tenantId } });
  if (count >= sub.plan.maxProducts) {
    return { allowed: false, code: "PLAN_LIMIT", message: `Product limit reached (${count}/${sub.plan.maxProducts})` };
  }
  return { allowed: true };
}

export async function seatCountEnforced(tenantId: string): Promise<{ allowed: true } | { allowed: false; code: string; message: string }> {
  const sub = await getSubscription(tenantId);
  if (sub.plan.maxSeats == null) return { allowed: true };
  const count = await prisma.membership.count({ where: { tenantId } });
  if (count >= sub.plan.maxSeats) {
    return { allowed: false, code: "PLAN_LIMIT", message: `Seat limit reached (${count}/${sub.plan.maxSeats})` };
  }
  return { allowed: true };
}

/**
 * Immediate downgrade to a cheaper plan (free included). Upgrades go through
 * Fawry checkout instead. Existing over-limit resources keep working — the
 * creation gates (products, AI, documents, seats) block only new usage.
 * Pending payment links die with the ref; downgrading to free also clears
 * any PAST_DUE state since nothing is owed on a free plan.
 */
export async function downgradePlan(
  tenantId: string,
  targetSlug: string,
  actor: string
): Promise<{ ok: true; subscription: { status: string; plan: { slug: string; name: string } } } | { ok: false; error: string }> {
  await ensureDefaultPlans();
  const target = await prisma.plan.findUnique({ where: { slug: targetSlug } });
  if (!target || !target.active) return { ok: false, error: "invalid_plan" };
  const sub = await getSubscription(tenantId);
  if (target.id === sub.planId) return { ok: false, error: "same_plan" };
  if ((target.priceEgp ?? 0) >= (sub.plan.priceEgp ?? 0)) return { ok: false, error: "not_downgrade" };
  const free = (target.priceEgp ?? 0) <= 0;
  const updated = await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      planId: target.id,
      providerRef: null,
      lastProviderEvent: null,
      status: free ? "ACTIVE" : sub.status,
      currentPeriodEnd: free ? null : sub.currentPeriodEnd,
    },
  });
  await audit({ tenantId, actor, action: "billing.downgraded", resource: "subscription", resourceId: sub.id, newValue: { from: sub.plan.slug, to: target.slug } });
  return { ok: true, subscription: { status: updated.status, plan: { slug: target.slug, name: target.name } } };
}
