import { prisma } from "@ai-commerce/database";
import type { PromotionInput, PromotionKind } from "@ai-commerce/shared";
import { audit } from "./audit";

export const PROMO_KINDS: PromotionKind[] = ["PERCENT", "FIXED", "BXGY", "FREE_SHIPPING"];

export interface PromotionUpsert {
  name: string;
  kind: PromotionKind;
  value?: number;
  minSubtotal?: number | null;
  productIds?: string[];
  buyQty?: number | null;
  getQty?: number | null;
  startAt?: Date | null;
  endAt?: Date | null;
  active?: boolean;
  usageLimit?: number | null;
}

/** Strict server-side validation: the model can never create promos (dashboard-only), and bad math can't enter. */
export function validatePromotion(input: PromotionUpsert): string | null {
  if (!input.name.trim() || input.name.length > 120) return "Name 1..120 chars";
  if (!PROMO_KINDS.includes(input.kind)) return "Unknown kind";
  if (input.kind === "PERCENT" && (!(input.value ?? NaN) || input.value! < 1 || input.value! > 90)) {
    return "Percent must be 1..90";
  }
  if (input.kind === "FIXED" && (!(input.value ?? 0) || input.value! < 0 || input.value! > 100000000)) {
    return "Fixed amount invalid";
  }
  if (input.kind === "BXGY") {
    if (!(input.buyQty ?? 0) || input.buyQty! < 1 || input.buyQty! > 99) return "buyQty must be 1..99";
    if (!(input.getQty ?? 0) || input.getQty! < 1 || input.getQty! > 99) return "getQty must be 1..99";
    if (!input.productIds || input.productIds.length === 0) return "BXGY needs product scope";
  }
  if (input.minSubtotal != null && (input.minSubtotal < 0 || input.minSubtotal > 100000000)) return "minSubtotal invalid";
  if (input.usageLimit != null && (input.usageLimit < 1 || input.usageLimit > 1000000)) return "usageLimit invalid";
  if (input.startAt && input.endAt && input.startAt > input.endAt) return "startAt must precede endAt";
  return null;
}

/** Live promos shaped for the pricing engine (usage-capped ones excluded). */
export async function activePromotionsForOrder(tenantId: string, now = new Date()): Promise<PromotionInput[]> {
  const rows = await prisma.promotion.findMany({ where: { tenantId, active: true }, orderBy: { createdAt: "asc" } });
  return rows
    .filter((r) => {
      if (r.startAt && now < r.startAt) return false;
      if (r.endAt && now > r.endAt) return false;
      if (r.usageLimit != null && r.usedCount >= r.usageLimit) return false;
      return true;
    })
    .map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      value: r.value,
      minSubtotal: r.minSubtotal,
      productIds: r.productIds,
      buyQty: r.buyQty,
      getQty: r.getQty,
      startAt: r.startAt,
      endAt: r.endAt,
      active: r.active,
      usageLimit: r.usageLimit,
      usedCount: r.usedCount,
    }));
}

/** Best-effort usage accounting at confirm time (never fails confirmation). */
export async function recordPromoUsage(tenantId: string, promotionIds: string[]): Promise<void> {
  if (promotionIds.length === 0) return;
  try {
    await prisma.promotion.updateMany({
      where: { tenantId, id: { in: [...new Set(promotionIds)] } },
      data: { usedCount: { increment: 1 } },
    });
  } catch {
    /* accounting never breaks confirmation */
  }
}

export async function createPromotion(tenantId: string, input: PromotionUpsert, actor: string) {
  const err = validatePromotion(input);
  if (err) throw new Error(err);
  if (input.productIds?.length) {
    const count = await prisma.product.count({ where: { tenantId, id: { in: input.productIds } } });
    if (count !== input.productIds.length) throw new Error("Unknown product in scope");
  }
  const promo = await prisma.promotion.create({
    data: {
      tenantId,
      name: input.name.trim(),
      kind: input.kind,
      value: Math.floor(input.value ?? 0),
      minSubtotal: input.minSubtotal ?? undefined,
      productIds: input.productIds ?? [],
      buyQty: input.buyQty ?? undefined,
      getQty: input.getQty ?? undefined,
      startAt: input.startAt ?? undefined,
      endAt: input.endAt ?? undefined,
      active: input.active ?? true,
      usageLimit: input.usageLimit ?? undefined,
    },
  });
  await audit({ tenantId, actor, action: "promotion.created", resource: "promotion", resourceId: promo.id, newValue: { name: promo.name, kind: promo.kind } });
  return promo;
}

export async function deletePromotion(tenantId: string, id: string, actor: string) {
  const promo = await prisma.promotion.findFirst({ where: { id, tenantId } });
  if (!promo) throw new Error("PROMOTION_NOT_FOUND");
  await prisma.promotion.delete({ where: { id } });
  await audit({ tenantId, actor, action: "promotion.deleted", resource: "promotion", resourceId: id });
  return { deleted: true };
}
