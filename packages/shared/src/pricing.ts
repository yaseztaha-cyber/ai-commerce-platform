export interface OrderLineInput {
  productId: string;
  variantId: string;
  productName: string;
  variantLabel: string;
  sku?: string | null;
  unitPrice: number; // minor units? No: major units (EGP). Keep integer EGP.
  quantity: number;
  imageUrl?: string | null;
}

export interface OrderTotals {
  subtotal: number;
  discount: number;
  deliveryFee: number;
  tax: number;
  total: number;
}

export type PromotionKind = "PERCENT" | "FIXED" | "BXGY" | "FREE_SHIPPING";

export interface PromotionInput {
  id?: string;
  name: string;
  kind: PromotionKind | string;
  value: number;
  minSubtotal?: number | null;
  /** Empty/omitted = all products. Otherwise only these product IDs. */
  productIds?: string[];
  buyQty?: number | null;
  getQty?: number | null;
  startAt?: Date | string | null;
  endAt?: Date | string | null;
  active?: boolean;
  usageLimit?: number | null;
  usedCount?: number | null;
}

export interface AppliedPromo {
  promotionId?: string;
  name: string;
  kind: string;
  amount: number;
}

function promoEligible(p: PromotionInput, subtotal: number, now: Date): boolean {
  if (p.active === false) return false;
  if (p.startAt && now < new Date(p.startAt)) return false;
  if (p.endAt && now > new Date(p.endAt)) return false;
  if (p.usageLimit != null && (p.usedCount ?? 0) >= p.usageLimit) return false;
  if (p.minSubtotal != null && subtotal < p.minSubtotal) return false;
  return true;
}

/**
 * Backend-owned promotion math. Promos stack additively on ORIGINAL lines,
 * clamped so discount never exceeds subtotal. Deterministic (sorted by id).
 * The model may quote these results but can never create or alter them.
 */
export function applyPromotions(
  lines: Array<{ unitPrice: number; quantity: number; productId?: string }>,
  promos: PromotionInput[],
  now = new Date()
): { discount: number; applied: AppliedPromo[]; freeShipping: boolean } {
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const applied: AppliedPromo[] = [];
  let freeShipping = false;
  const sorted = [...promos].sort((a, b) => String(a.id ?? a.name).localeCompare(String(b.id ?? b.name)));
  for (const p of sorted) {
    if (!promoEligible(p, subtotal, now)) continue;
    const eligible =
      p.productIds && p.productIds.length > 0
        ? lines.filter((l) => l.productId != null && p.productIds!.includes(l.productId))
        : lines;
    if (eligible.length === 0) continue;
    const eligibleSubtotal = eligible.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
    if (eligibleSubtotal <= 0) continue;
    if (p.kind === "FREE_SHIPPING") {
      freeShipping = true;
      applied.push({ promotionId: p.id, name: p.name, kind: p.kind, amount: 0 });
    } else if (p.kind === "PERCENT") {
      const pct = Math.max(0, Math.min(90, p.value));
      if (pct <= 0) continue;
      applied.push({ promotionId: p.id, name: p.name, kind: p.kind, amount: roundMoney((eligibleSubtotal * pct) / 100) });
    } else if (p.kind === "FIXED") {
      if (!(p.value > 0)) continue;
      applied.push({ promotionId: p.id, name: p.name, kind: p.kind, amount: roundMoney(Math.min(p.value, eligibleSubtotal)) });
    } else if (p.kind === "BXGY") {
      const buy = Math.floor(p.buyQty ?? 0);
      const get = Math.floor(p.getQty ?? 0);
      if (buy < 1 || get < 1) continue;
      let amount = 0;
      for (const l of eligible) {
        amount += Math.floor(l.quantity / (buy + get)) * get * l.unitPrice;
      }
      if (amount <= 0) continue;
      applied.push({ promotionId: p.id, name: p.name, kind: p.kind, amount: roundMoney(amount) });
    }
    // Unknown kinds are ignored (fail closed).
  }
  const discount = Math.min(
    subtotal,
    roundMoney(applied.reduce((s, a) => s + a.amount, 0))
  );
  return { discount, applied, freeShipping };
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Single source of truth for order math.
 * Used by API, agent tools, and tests — never duplicated in prompts.
 */
export function calculateTotals(args: {
  lines: Array<{ unitPrice: number; quantity: number; productId?: string }>;
  deliveryFee?: number;
  discount?: number;
  taxRate?: number; // e.g. 0.14
  freeDeliveryThreshold?: number | null;
  minimumOrderAmount?: number | null;
  promotions?: PromotionInput[];
  now?: Date;
}): OrderTotals & { freeDeliveryApplied: boolean; promoFreeShipping: boolean; appliedPromos: AppliedPromo[] } {
  const deliveryFee = Math.max(0, args.deliveryFee ?? 0);
  const explicitDiscount = Math.max(0, args.discount ?? 0);
  const subtotal = roundMoney(
    args.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0)
  );
  const promo = args.promotions?.length
    ? applyPromotions(args.lines, args.promotions, args.now ?? new Date())
    : { discount: 0, applied: [] as AppliedPromo[], freeShipping: false };
  const discount = Math.min(subtotal, roundMoney(explicitDiscount + promo.discount));
  const afterDiscount = Math.max(0, roundMoney(subtotal - discount));
  let effectiveDelivery = deliveryFee;
  let freeDeliveryApplied = false;
  if (promo.freeShipping && afterDiscount > 0) {
    effectiveDelivery = 0;
  } else if (
    args.freeDeliveryThreshold != null &&
    args.freeDeliveryThreshold > 0 &&
    afterDiscount >= args.freeDeliveryThreshold
  ) {
    effectiveDelivery = 0;
    freeDeliveryApplied = true;
  }
  const tax = args.taxRate ? roundMoney(afterDiscount * args.taxRate) : 0;
  const total = roundMoney(afterDiscount + effectiveDelivery + tax);
  return { subtotal, discount, deliveryFee: effectiveDelivery, tax, total, freeDeliveryApplied, promoFreeShipping: promo.freeShipping && afterDiscount > 0, appliedPromos: promo.applied };
}

export function validateOrderBusinessRules(args: {
  subtotal: number;
  quantity: number;
  minimumOrderAmount?: number | null;
  maximumQuantity?: number | null;
  deliveryZoneAllowed: boolean;
}): { ok: true } | { ok: false; code: string; message: string } {
  if (args.minimumOrderAmount != null && args.subtotal < args.minimumOrderAmount) {
    return {
      ok: false,
      code: "BELOW_MINIMUM",
      message: `Order subtotal ${args.subtotal} is below minimum ${args.minimumOrderAmount}`,
    };
  }
  if (args.maximumQuantity != null && args.quantity > args.maximumQuantity) {
    return {
      ok: false,
      code: "QUANTITY_EXCEEDED",
      message: `Quantity ${args.quantity} exceeds maximum ${args.maximumQuantity}`,
    };
  }
  if (!args.deliveryZoneAllowed) {
    return { ok: false, code: "ZONE_NOT_SERVED", message: "Delivery zone is not served" };
  }
  return { ok: true };
}
