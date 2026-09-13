import { prisma } from "@ai-commerce/database";
import { calculateTotals, canTransitionOrder, validateOrderBusinessRules, type OrderStatus } from "@ai-commerce/shared";
import { variantLabel } from "./products";
import { touchCustomerStats } from "./customers";
import { audit } from "./audit";
import { notifyBusiness, notifyCustomer } from "./notifications";

/**
 * Create a DRAFT order (cart). Prices are resolved NOW from product/variant
 * but the order is not final — stock is only reserved at confirm time.
 */
export async function createOrderDraft(input: {
  tenantId: string;
  conversationId?: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  address?: string;
  deliveryZoneId?: string | null;
  paymentMethod?: string;
  idempotencyKey: string;
  lines: Array<{ variantId: string; quantity: number }>;
  actor?: string;
}) {
  // Idempotent replay: same tenant+key returns existing order
  const existing = await prisma.order.findUnique({
    where: { tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey } },
    include: { items: true },
  });
  if (existing) return { order: existing, duplicate: true };

  const tenant = await prisma.tenant.findUnique({
    where: { id: input.tenantId },
    include: { deliveryZones: true },
  });
  if (!tenant) throw new Error("TENANT_NOT_FOUND");

  const variants = await prisma.productVariant.findMany({
    where: { tenantId: input.tenantId, id: { in: input.lines.map((l) => l.variantId) } },
    include: { product: true, inventory: true },
  });
  if (variants.length !== input.lines.length) throw new Error("VARIANT_NOT_FOUND");

  const zone = input.deliveryZoneId
    ? tenant.deliveryZones.find((z) => z.id === input.deliveryZoneId && z.active)
    : tenant.deliveryZones.find((z) => z.active);

  const items = input.lines.map((l) => {
    const v = variants.find((x) => x.id === l.variantId)!;
    const unitPrice = v.price ?? v.product.basePrice;
    return {
      productId: v.productId,
      variantId: v.id,
      productName: v.product.name,
      variantLabel: variantLabel((v.attributes as Record<string, string>) ?? {}),
      sku: v.sku,
      unitPrice,
      quantity: l.quantity,
      lineTotal: unitPrice * l.quantity,
    };
  });

  const { activePromotionsForOrder } = await import("./promotions");
  const promotions = await activePromotionsForOrder(input.tenantId);
  const totals = calculateTotals({
    lines: items,
    deliveryFee: zone?.fee ?? 0,
    freeDeliveryThreshold: tenant.freeDeliveryThreshold,
    minimumOrderAmount: undefined,
    taxRate: tenant.taxRate ?? undefined,
    promotions,
  });

  const ruleCheck = validateOrderBusinessRules({
    subtotal: totals.subtotal,
    quantity: items.reduce((s, i) => s + i.quantity, 0),
    minimumOrderAmount: tenant.minimumOrderAmount,
    maximumQuantity: tenant.maximumQuantity,
    deliveryZoneAllowed: true,
  });
  if (!ruleCheck.ok) throw new Error(ruleCheck.code);

  const order = await prisma.$transaction(async (tx) => {
    // Atomic per-tenant numbering: the incrementing UPDATE is the single
    // linearization point, so concurrent drafts can never collide on
    // (tenantId, number). Gaps are possible on rollback; duplicates are not.
    const counter = await tx.tenant.update({
      where: { id: input.tenantId },
      data: { orderSeq: { increment: 1 } },
      select: { orderSeq: true },
    });
    const created = await tx.order.create({
      data: {
        tenantId: input.tenantId,
        number: counter.orderSeq,
        customerId: input.customerId,
        conversationId: input.conversationId,
        status: "DRAFT",
        subtotal: totals.subtotal,
        discount: totals.discount,
        deliveryFee: totals.deliveryFee,
        tax: totals.tax,
        total: totals.total,
        currency: tenant.currency,
        paymentMethod: input.paymentMethod ?? "CASH_ON_DELIVERY",
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        address: input.address,
        deliveryZoneId: zone?.id,
        sourceChannel: "WHATSAPP",
        idempotencyKey: input.idempotencyKey,
        appliedPromos: totals.appliedPromos as never,
        items: { create: items.map((i) => ({ ...i, tenantId: input.tenantId })) },
        history: { create: [{ tenantId: input.tenantId, oldStatus: null, newStatus: "DRAFT", actor: input.actor ?? "system", reason: "draft created" }] },
      },
      include: { items: true },
    });
    return created;
  });

  await audit({ tenantId: input.tenantId, actor: input.actor ?? "system", action: "order.draft_created", resource: "order", resourceId: order.id });
  return { order, duplicate: false };
}

/**
 * Confirm an order: validates stock transactionally, decrements inventory
 * with movement records, snapshots prices, transitions DRAFT/PENDING -> CONFIRMED.
 * Concurrency-safe: the transaction re-checks stock at commit time.
 */
export async function confirmOrder(input: {
  tenantId: string;
  orderId: string;
  idempotencyKey?: string;
  actor?: string;
}) {
  const order = await prisma.order.findFirst({
    where: { id: input.orderId, tenantId: input.tenantId },
    include: { items: true, conversation: true, customer: true },
  });
  if (!order) throw new Error("ORDER_NOT_FOUND");
  if (order.status === "CONFIRMED") return { order, duplicate: true };
  if (!["DRAFT", "PENDING_CONFIRMATION"].includes(order.status)) throw new Error(`INVALID_STATE:${order.status}`);

  // COD fake-order protection: tenants with phone verification on cannot
  // confirm an order whose phone lacks a verified code for THIS order.
  // No bypass path exists — the agent must send + verify a code first.
  const tenant = await prisma.tenant.findUnique({ where: { id: input.tenantId }, select: { requirePhoneVerify: true } });
  if (tenant?.requirePhoneVerify && order.customerPhone) {
    const { isOrderPhoneVerified } = await import("./verify");
    if (!(await isOrderPhoneVerified(input.tenantId, order.id))) {
      throw new Error("PHONE_NOT_VERIFIED");
    }
  }

  const confirmed = await prisma.$transaction(async (tx) => {
    // Concurrency-safe: re-check availability AND decrement atomically.
    // The guarded updateMany is the single linearization point — two racers
    // on the last piece cannot both succeed (loser gets count 0).
    const variantIds = order.items.map((i) => i.variantId).sort();
    const variants = await tx.productVariant.findMany({
      where: { tenantId: input.tenantId, id: { in: variantIds } },
      include: { inventory: true, product: true },
    });
    for (const item of order.items) {
      const v = variants.find((x) => x.id === item.variantId);
      if (!v || !v.active || !v.product.active) throw new Error("VARIANT_UNAVAILABLE");
    }
    for (const item of order.items) {
      const v = variants.find((x) => x.id === item.variantId)!;
      const res = await tx.inventory.updateMany({
        where: { variantId: v.id, quantity: { gte: item.quantity } },
        data: { quantity: { decrement: item.quantity } },
      });
      if (res.count === 0) {
        const cur = await tx.inventory.findUnique({ where: { variantId: v.id } });
        throw new Error(`INSUFFICIENT_STOCK:${v.sku}:${cur?.quantity ?? 0}`);
      }
      const after = (await tx.inventory.findUnique({ where: { variantId: v.id } }))?.quantity ?? 0;
      const before = after + item.quantity;
      await tx.inventoryMovement.create({
        data: { tenantId: input.tenantId, variantId: v.id, type: "SALE", delta: -item.quantity, before, after, actor: input.actor ?? "system", orderId: order.id },
      });
      if (after <= 3) {
        await tx.notification.create({
          data: { tenantId: input.tenantId, kind: "LOW_STOCK", channel: "CONSOLE", payload: { variantId: v.id, sku: v.sku, quantity: after } as never, status: "QUEUED" },
        });
      }
    }
    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        status: "CONFIRMED",
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        history: { create: [{ tenantId: input.tenantId, oldStatus: order.status, newStatus: "CONFIRMED", actor: input.actor ?? "system", reason: "customer confirmed" }] },
      },
      include: { items: true },
    });
    if (order.customerId) {
      await tx.customer.update({ where: { id: order.customerId }, data: { totalOrders: { increment: 1 }, totalSpent: { increment: order.total } } });
    }
    if (order.conversationId) {
      await tx.conversation.update({ where: { id: order.conversationId }, data: { orderState: "ORDER_CREATED" } });
    }
    return updated;
  });

  await audit({ tenantId: input.tenantId, actor: input.actor ?? "system", action: "order.confirmed", resource: "order", resourceId: confirmed.id, newValue: { total: confirmed.total } });
  // Promotion usage accounting (best-effort; never fails confirmation).
  // The draft snapshot wins: later promo edits never rewrite old orders.
  const snapshotted = ((confirmed as unknown as { appliedPromos?: Array<{ promotionId?: string }> }).appliedPromos ?? [])
    .map((p) => p.promotionId)
    .filter((id): id is string => Boolean(id));
  if (snapshotted.length > 0) {
    const { recordPromoUsage } = await import("./promotions");
    void recordPromoUsage(input.tenantId, snapshotted);
  }
  // Notifications (async, never block confirmation result)
  void notifyBusiness(input.tenantId, "NEW_ORDER", formatNewOrderMessage(confirmed as never)).catch(() => {});
  if (order.customerId) void notifyCustomer(input.tenantId, order.customerId, `تم تأكيد الأوردر ✅ رقم #${confirmed.number}. الإجمالي ${confirmed.total}.`).catch(() => {});
  void touchCustomerStatsSafe(input.tenantId);
  if (order.customerId) void maybeRememberSizeFromOrder(input.tenantId, confirmed.id, order.customerId).catch(() => {});
  return { order: confirmed, duplicate: false };
}

/**
 * Opt-in-by-consistency size memory: after a confirmed order whose items are
 * ALL one size S, if the customer's previous finalized order was also all
 * size S (and no size is stored yet), remember S. Explicit opt-in via the
 * remember_customer_size tool always wins and is never overwritten here.
 * Fire-and-forget: must never affect confirmation.
 */
async function maybeRememberSizeFromOrder(tenantId: string, orderId: string, customerId: string): Promise<void> {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId }, select: { preferredSize: true } });
  if (!customer || customer.preferredSize) return;
  const items = await prisma.orderItem.findMany({
    where: { orderId },
    include: { variant: { select: { attributes: true } } },
  });
  const sizes = new Set(
    items.map((i) => {
      const a = (i.variant?.attributes ?? {}) as Record<string, string>;
      return String(a.Size ?? a.size ?? "").toUpperCase();
    })
  );
  if (sizes.size !== 1) return;
  const [size] = [...sizes];
  if (!/^[A-Z0-9]{1,6}$/.test(size)) return;
  const prev = await prisma.order.findFirst({
    where: { tenantId, customerId, id: { not: orderId }, status: { notIn: ["DRAFT", "PENDING_CONFIRMATION", "CANCELLED", "FAILED"] } },
    orderBy: { createdAt: "desc" },
    include: { items: { include: { variant: { select: { attributes: true } } } } },
  });
  if (!prev || prev.items.length === 0) return;
  const prevSizes = new Set(
    prev.items.map((i) => {
      const a = (i.variant?.attributes ?? {}) as Record<string, string>;
      return String(a.Size ?? a.size ?? "").toUpperCase();
    })
  );
  if (prevSizes.size === 1 && prevSizes.has(size)) {
    await prisma.customer.update({ where: { id: customerId }, data: { preferredSize: size } });
  }
}

async function touchCustomerStatsSafe(_tenantId: string) {
  void _tenantId;
  return;
}

export function formatNewOrderMessage(order: {
  number: number;
  customerName?: string | null;
  customerPhone?: string | null;
  items: Array<{ productName: string; variantLabel: string; quantity: number; unitPrice: number }>;
  subtotal: number;
  deliveryFee: number;
  total: number;
  address?: string | null;
  paymentMethod: string;
  status: string;
}): string {
  const lines = order.items
    .map((i) => `${i.productName} — ${i.variantLabel} — ×${i.quantity} (${i.unitPrice})`)
    .join("\n");
  return [
    `NEW ORDER #${order.number}`,
    ``,
    `Customer: ${order.customerName ?? "-"}`,
    `Phone: ${order.customerPhone ?? "-"}`,
    ``,
    `Items:`,
    lines,
    ``,
    `Subtotal: ${order.subtotal}`,
    `Delivery: ${order.deliveryFee}`,
    `Total: ${order.total}`,
    ``,
    `Address: ${order.address ?? "-"}`,
    `Payment: ${order.paymentMethod}`,
    `Status: ${order.status}`,
  ].join("\n");
}

export async function transitionOrder(input: {
  tenantId: string;
  orderId: string;
  to: OrderStatus;
  actor: string;
  reason?: string;
}) {
  const order = await prisma.order.findFirst({ where: { id: input.orderId, tenantId: input.tenantId } });
  if (!order) throw new Error("ORDER_NOT_FOUND");
  if (!canTransitionOrder(order.status as OrderStatus, input.to)) {
    throw new Error(`ILLEGAL_TRANSITION:${order.status}->${input.to}`);
  }
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: {
      status: input.to,
      history: { create: [{ tenantId: input.tenantId, oldStatus: order.status, newStatus: input.to, actor: input.actor, reason: input.reason }] },
    },
  });
  await audit({ tenantId: input.tenantId, actor: input.actor, action: "order.status_changed", resource: "order", resourceId: order.id, oldValue: { status: order.status }, newValue: { status: input.to } });
  if (order.customerId && ["READY", "OUT_FOR_DELIVERY", "COMPLETED", "CANCELLED"].includes(input.to)) {
    void notifyCustomer(input.tenantId, order.customerId, `تحديث الأوردر #${order.number}: ${input.to}`).catch(() => {});
  }
  return updated;
}

export async function cancelOrder(input: { tenantId: string; orderId: string; actor: string; reason?: string; restock?: boolean }) {
  const order = await prisma.order.findFirst({ where: { id: input.orderId, tenantId: input.tenantId }, include: { items: true } });
  if (!order) throw new Error("ORDER_NOT_FOUND");
  const updated = await transitionOrder({ tenantId: input.tenantId, orderId: order.id, to: "CANCELLED", actor: input.actor, reason: input.reason ?? "cancelled" });
  if (input.restock && ["CONFIRMED", "PROCESSING"].includes(order.status)) {
    const { adjustStock } = await import("./inventory");
    for (const item of order.items) {
      await adjustStock({ tenantId: input.tenantId, variantId: item.variantId, delta: item.quantity, type: "RETURN", reason: `cancel order #${order.number}`, actor: input.actor, orderId: order.id });
    }
  }
  void touchCustomerStats;
  return updated;
}

const TERMINAL_AMEND_BLOCK = ["COMPLETED", "CANCELLED", "FAILED", "RETURNED", "REFUNDED"] as const;

export interface AmendOrderInput {
  tenantId: string;
  orderId: string;
  actor: string;
  address?: string;
  customerName?: string;
  customerPhone?: string;
  notes?: string;
  /** Full replacement item list. Only when status is CONFIRMED (pre-PROCESSING). */
  items?: Array<{ variantId: string; quantity: number }>;
}

/**
 * Dashboard-only amendment of a live order (the AI never calls this).
 * - Contact/address/notes: editable until the order is terminal or out for delivery.
 * - Items: editable only while CONFIRMED. Quantity increases reserve stock
 *   atomically (guarded decrement); decreases release it. Everything happens
 *   in ONE transaction — no partial amendments, INSUFFICIENT_STOCK aborts all.
 */
export async function amendOrder(input: AmendOrderInput) {
  const order = await prisma.order.findFirst({
    where: { id: input.orderId, tenantId: input.tenantId },
    include: { items: true },
  });
  if (!order) throw new Error("ORDER_NOT_FOUND");

  const wantsItems = input.items !== undefined;
  if (wantsItems && order.status !== "CONFIRMED") {
    throw new Error(`INVALID_STATE:items editable only while CONFIRMED (is ${order.status})`);
  }
  if ((TERMINAL_AMEND_BLOCK as readonly string[]).includes(order.status) || order.status === "OUT_FOR_DELIVERY") {
    if (input.address !== undefined || input.customerName !== undefined || input.customerPhone !== undefined || input.notes !== undefined) {
      throw new Error(`INVALID_STATE:contact details frozen while ${order.status}`);
    }
  }
  if (input.items) {
    for (const l of input.items) {
      if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 99) throw new Error("INVALID_QTY");
    }
  }

  const before = {
    address: order.address,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    notes: order.notes,
    items: order.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
  };

  const updated = await prisma.$transaction(async (tx) => {
    if (wantsItems && input.items) {
      const variantIds = [...new Set(input.items.map((l) => l.variantId))].sort();
      const variants = await tx.productVariant.findMany({
        where: { tenantId: input.tenantId, id: { in: variantIds } },
        include: { product: true },
      });
      const byId = new Map(variants.map((v) => [v.id, v]));
      for (const l of input.items) {
        const v = byId.get(l.variantId);
        if (!v || !v.active || !v.product.active) throw new Error(`VARIANT_UNAVAILABLE:${l.variantId}`);
      }
      const oldById = new Map(order.items.map((i) => [i.variantId, i]));
      // Stock reconciliation first (all-or-nothing before touching lines).
      for (const l of input.items) {
        const oldQty = oldById.get(l.variantId)?.quantity ?? 0;
        const diff = l.quantity - oldQty;
        if (diff > 0) {
          const res = await tx.inventory.updateMany({
            where: { variantId: l.variantId, quantity: { gte: diff } },
            data: { quantity: { decrement: diff } },
          });
          if (res.count === 0) {
            const v = byId.get(l.variantId)!;
            throw new Error(`INSUFFICIENT_STOCK:${v.sku}`);
          }
          const after = (await tx.inventory.findUnique({ where: { variantId: l.variantId } }))?.quantity ?? 0;
          await tx.inventoryMovement.create({
            data: { tenantId: input.tenantId, variantId: l.variantId, type: "SALE", delta: -diff, before: after + diff, after, actor: input.actor, orderId: order.id },
          });
        } else if (diff < 0) {
          await tx.inventory.updateMany({ where: { variantId: l.variantId }, data: { quantity: { increment: -diff } } });
          const after = (await tx.inventory.findUnique({ where: { variantId: l.variantId } }))?.quantity ?? 0;
          await tx.inventoryMovement.create({
            data: { tenantId: input.tenantId, variantId: l.variantId, type: "RETURN", delta: -diff, before: after + diff, after, actor: input.actor, orderId: order.id },
          });
        }
      }
      // Apply line changes.
      const wanted = new Map(input.items.map((l) => [l.variantId, l.quantity]));
      for (const item of order.items) {
        if (!wanted.has(item.variantId)) {
          await tx.orderItem.delete({ where: { id: item.id } });
        }
      }
      for (const l of input.items) {
        const v = byId.get(l.variantId)!;
        const unitPrice = v.price ?? v.product.basePrice;
        const existing = order.items.find((i) => i.variantId === l.variantId);
        if (existing) {
          await tx.orderItem.update({ where: { id: existing.id }, data: { quantity: l.quantity, unitPrice, lineTotal: unitPrice * l.quantity } });
        } else {
          await tx.orderItem.create({
            data: {
              tenantId: input.tenantId,
              orderId: order.id,
              productId: v.productId,
              variantId: v.id,
              productName: v.product.name,
              variantLabel: variantLabel((v.attributes as Record<string, string>) ?? {}),
              sku: v.sku,
              unitPrice,
              quantity: l.quantity,
              lineTotal: unitPrice * l.quantity,
            },
          });
        }
      }
    }
    // Re-total from backend pricing, re-applying live promotions and
    // re-snapshotting (amendments create a new price truth with history).
    const refreshed = await tx.order.findFirst({ where: { id: order.id }, include: { items: true } });
    const tenant = await tx.tenant.findUnique({ where: { id: input.tenantId } });
    const { activePromotionsForOrder } = await import("./promotions");
    const promotions = await activePromotionsForOrder(input.tenantId);
    const totals = calculateTotals({
      lines: (refreshed?.items ?? []).map((i) => ({ unitPrice: i.unitPrice, quantity: i.quantity, productId: i.productId })),
      deliveryFee: refreshed?.deliveryFee ?? 0,
      freeDeliveryThreshold: tenant?.freeDeliveryThreshold,
      taxRate: tenant?.taxRate ?? undefined,
      promotions,
    });
    return tx.order.update({
      where: { id: order.id },
      data: {
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.customerName !== undefined ? { customerName: input.customerName } : {}),
        ...(input.customerPhone !== undefined ? { customerPhone: input.customerPhone } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        subtotal: totals.subtotal,
        discount: totals.discount,
        deliveryFee: totals.deliveryFee,
        tax: totals.tax,
        total: totals.total,
        appliedPromos: totals.appliedPromos as never,
      },
      include: { items: true },
    });
  });

  await audit({
    tenantId: input.tenantId,
    actor: input.actor,
    action: "order.amended",
    resource: "order",
    resourceId: order.id,
    oldValue: before as never,
    newValue: {
      address: updated.address,
      customerName: updated.customerName,
      customerPhone: updated.customerPhone,
      notes: updated.notes,
      items: updated.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
    } as never,
  });
  return updated;
}
