import { prisma } from "@ai-commerce/database";
import { calculateTotals } from "@ai-commerce/shared";
import { z } from "zod";
import { variantLabel, searchProducts as productSearch, getProductWithVariants } from "../products";
import { getStock } from "../inventory";
import { createOrderDraft, confirmOrder, cancelOrder } from "../orders";
import { requestHuman } from "../conversations";
import { retrieveKnowledge } from "../rag/retrieve";
import { getMeasurements, rankSizes, type FitPreference } from "../sizing";
import { meter } from "../billing";
import type { ToolDef } from "./llm";

/**
 * Typed tool registry. Every tool:
 * - validates input (zod)
 * - takes tenantId from SERVER context (never from the LLM)
 * - enforces business rules
 * - returns structured output
 * - logs execution to ToolCall
 */

export interface ToolContext {
  tenantId: string;
  conversationId: string;
  customerId?: string;
  aiRunId?: string;
  actor?: string;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

type Handler = (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResult>;

const registry = new Map<string, { def: ToolDef; schema: z.ZodTypeAny; handler: Handler }>();

function register(name: string, description: string, parameters: Record<string, unknown>, schema: z.ZodTypeAny, handler: Handler) {
  registry.set(name, { def: { name, description, parameters }, schema, handler });
}

export function toolDefinitions(): ToolDef[] {
  return [...registry.values()].map((r) => r.def);
}

export async function executeTool(ctx: ToolContext, name: string, rawArgs: Record<string, unknown>): Promise<ToolResult> {
  const started = Date.now();
  const entry = registry.get(name);
  if (!entry) {
    await logTool(ctx, name, rawArgs, { success: false, error: { code: "UNKNOWN_TOOL", message: name } }, Date.now() - started);
    return { success: false, error: { code: "UNKNOWN_TOOL", message: `Unknown tool ${name}` } };
  }
  const parsed = entry.schema.safeParse(rawArgs);
  if (!parsed.success) {
    const res: ToolResult = { success: false, error: { code: "INVALID_ARGS", message: parsed.error.errors.map((e) => e.message).join("; ").slice(0, 300) } };
    await logTool(ctx, name, rawArgs, res, Date.now() - started);
    return res;
  }
  try {
    const res = await entry.handler(ctx, parsed.data as Record<string, unknown>);
    await logTool(ctx, name, rawArgs, res, Date.now() - started);
    return res;
  } catch (err) {
    const res: ToolResult = { success: false, error: { code: "TOOL_FAILED", message: err instanceof Error ? err.message.slice(0, 300) : "Tool failed" } };
    await logTool(ctx, name, rawArgs, res, Date.now() - started, String(err));
    return res;
  }
}

async function logTool(ctx: ToolContext, name: string, args: unknown, res: ToolResult, latencyMs: number, error?: string) {
  void meter(ctx.tenantId, "tool_call");
  try {
    await prisma.toolCall.create({
      data: {
        tenantId: ctx.tenantId,
        aiRunId: ctx.aiRunId,
        conversationId: ctx.conversationId,
        name,
        arguments: args as never,
        result: { success: res.success, data: res.data ?? null, error: res.error ?? null } as never,
        success: res.success,
        error: error ?? res.error?.message,
        latencyMs,
      },
    });
  } catch {
    /* logging never breaks the turn */
  }
}

// ---------------- tools ----------------

register(
  "search_products",
  "Search the store catalog by name/alias (Arabic+English, fuzzy). Returns candidates with confidence — ask if unsure.",
  { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  z.object({ query: z.string().min(1).max(200) }),
  async (ctx, args) => {
    const a = args as { query: string };
    const hits = await productSearch(ctx.tenantId, a.query, 5);
    return { success: true, data: { candidates: hits } };
  }
);

register(
  "get_product",
  "Get full product details with variants and live stock.",
  { type: "object", properties: { product_id: { type: "string" } }, required: ["product_id"] },
  z.object({ product_id: z.string().min(1) }),
  async (ctx, args) => {
    const a = args as { product_id: string };
    const p = await getProductWithVariants(ctx.tenantId, a.product_id);
    if (!p) return { success: false, error: { code: "NOT_FOUND", message: "Product not found" } };
    return {
      success: true,
      data: {
        id: p.id,
        name: p.name,
        name_ar: p.nameAr,
        base_price: p.basePrice,
        images: (p.images ?? []).map((i: { url: string; alt?: string | null }) => ({ url: i.url, alt: i.alt ?? null })),
        variants: p.variants.map((v) => ({
          variant_id: v.id,
          sku: v.sku,
          price: v.price ?? p.basePrice,
          attributes: v.attributes,
          label: variantLabel((v.attributes as Record<string, string>) ?? {}),
          stock: v.inventory?.quantity ?? 0,
          active: v.active,
        })),
      },
    };
  }
);

register(
  "check_inventory",
  "Check live stock for a variant. Never quote stock without calling this.",
  { type: "object", properties: { variant_id: { type: "string" }, quantity: { type: "number" } }, required: ["variant_id"] },
  z.object({ variant_id: z.string().min(1), quantity: z.number().int().min(1).max(99).default(1) }),
  async (ctx, args) => {
    const a = args as { variant_id: string; quantity: number };
    const stock = await getStock(ctx.tenantId, a.variant_id);
    return { success: true, data: { variant_id: a.variant_id, requested: a.quantity, available: stock, in_stock: stock >= a.quantity } };
  }
);

register(
  "get_delivery_options",
  "List active delivery zones and fees. Never invent fees.",
  { type: "object", properties: {} },
  z.object({}),
  async (ctx) => {
    const zones = await prisma.deliveryZone.findMany({ where: { tenantId: ctx.tenantId, active: true }, orderBy: { fee: "asc" } });
    const tenant = await prisma.tenant.findUnique({ where: { id: ctx.tenantId } });
    return { success: true, data: { zones: zones.map((z) => ({ id: z.id, name: z.name, name_ar: z.nameAr, fee: z.fee, eta: z.eta })), free_delivery_threshold: tenant?.freeDeliveryThreshold ?? null } };
  }
);

register(
  "calculate_order",
  "Compute order totals via the backend pricing engine (promotions applied automatically).",
  { type: "object", properties: { lines: { type: "array" }, delivery_zone_id: { type: "string" } }, required: ["lines"] },
  z.object({ lines: z.array(z.object({ variant_id: z.string(), quantity: z.number().int().min(1).max(99) })).min(1).max(20), delivery_zone_id: z.string().optional() }),
  async (ctx, args) => {
    const a = args as { lines: Array<{ variant_id: string; quantity: number }>; delivery_zone_id?: string };
    const tenant = await prisma.tenant.findUnique({ where: { id: ctx.tenantId }, include: { deliveryZones: true } });
    const variants = await prisma.productVariant.findMany({
      where: { tenantId: ctx.tenantId, id: { in: a.lines.map((l) => l.variant_id) } },
      include: { product: true },
    });
    if (variants.length !== a.lines.length) return { success: false, error: { code: "VARIANT_NOT_FOUND", message: "A variant was not found" } };
    const zone = a.delivery_zone_id ? tenant?.deliveryZones.find((z) => z.id === a.delivery_zone_id) : tenant?.deliveryZones.find((z) => z.active);
    const lines = a.lines.map((l) => {
      const v = variants.find((x) => x.id === l.variant_id)!;
      return { unitPrice: v.price ?? v.product.basePrice, quantity: l.quantity, productId: v.productId };
    });
    const { activePromotionsForOrder } = await import("../promotions");
    const totals = calculateTotals({
      lines,
      deliveryFee: zone?.fee ?? 0,
      freeDeliveryThreshold: tenant?.freeDeliveryThreshold,
      taxRate: tenant?.taxRate ?? undefined,
      promotions: await activePromotionsForOrder(ctx.tenantId),
    });
    return { success: true, data: { ...totals, currency: tenant?.currency ?? "EGP", zone: zone ? { id: zone.id, name: zone.name, fee: zone.fee } : null } };
  }
);

register(
  "get_promotions",
  "List the store's CURRENT active offers. Quote ONLY these — never invent discounts, coupons, or bundles.",
  { type: "object", properties: {} },
  z.object({}),
  async (ctx) => {
    const { activePromotionsForOrder } = await import("../promotions");
    const promos = await activePromotionsForOrder(ctx.tenantId);
    return {
      success: true,
      data: {
        promotions: promos.map((p) => ({
          name: p.name,
          kind: p.kind,
          value: p.value,
          min_subtotal: p.minSubtotal,
          buy_qty: p.buyQty,
          get_qty: p.getQty,
          ends_at: p.endAt,
        })),
      },
    };
  }
);

register(
  "create_order_draft",
  "Create a draft order (cart). Requires at least one line. Prices snapshotted from backend.",
  { type: "object", properties: { lines: { type: "array" } }, required: ["lines", "idempotency_key"] },
  z.object({
    lines: z.array(z.object({ variant_id: z.string(), quantity: z.number().int().min(1).max(99) })).min(1).max(20),
    customer_name: z.string().max(200).optional(),
    customer_phone: z.string().max(40).optional(),
    address: z.string().max(1000).optional(),
    delivery_zone_id: z.string().optional(),
    payment_method: z.enum(["CASH_ON_DELIVERY", "BANK_TRANSFER", "PAYMENT_LINK", "MANUAL"]).default("CASH_ON_DELIVERY"),
    idempotency_key: z.string().min(4).max(120),
  }),
  async (ctx, args) => {
    const a = args as {
      lines: Array<{ variant_id: string; quantity: number }>;
      customer_name?: string; customer_phone?: string; address?: string;
      delivery_zone_id?: string; payment_method: "CASH_ON_DELIVERY" | "BANK_TRANSFER" | "PAYMENT_LINK" | "MANUAL";
      idempotency_key: string;
    };
    try {
      const customer = ctx.customerId ? await prisma.customer.findFirst({ where: { id: ctx.customerId, tenantId: ctx.tenantId } }) : null;
      // Supersede a stale open draft on this conversation so only one cart
      // is ever active (prevents orphan drafts accumulating across turns).
      const convo = await prisma.conversation.findFirst({ where: { id: ctx.conversationId, tenantId: ctx.tenantId } });
      if (convo?.draftOrderId) {
        const stale = await prisma.order.findFirst({ where: { id: convo.draftOrderId, tenantId: ctx.tenantId } });
        if (stale && ["DRAFT", "PENDING_CONFIRMATION"].includes(stale.status)) {
          try {
            await cancelOrder({ tenantId: ctx.tenantId, orderId: stale.id, actor: ctx.actor ?? "ai", reason: "superseded by newer draft" });
          } catch {
            /* already moved on — continue */
          }
        }
      }
      const { order, duplicate } = await createOrderDraft({
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId,
        customerId: ctx.customerId,
        customerName: a.customer_name ?? customer?.name ?? undefined,
        customerPhone: a.customer_phone ?? customer?.phone ?? undefined,
        address: a.address,
        deliveryZoneId: a.delivery_zone_id,
        paymentMethod: a.payment_method,
        idempotencyKey: `${ctx.conversationId}:${a.idempotency_key}`.slice(0, 120),
        lines: a.lines.map((l) => ({ variantId: l.variant_id, quantity: l.quantity })),
        actor: ctx.actor ?? "ai",
      });
      await prisma.conversation.update({ where: { id: ctx.conversationId }, data: { draftOrderId: order.id, orderState: "ORDER_REVIEW" } });
      const applied = ((order as unknown as { appliedPromos?: Array<{ name?: string }> }).appliedPromos ?? [])
        .map((p) => p?.name)
        .filter((n): n is string => Boolean(n));
      return { success: true, data: { order_id: order.id, number: null, subtotal: order.subtotal, discount: order.discount, delivery_fee: order.deliveryFee, total: order.total, applied_promos: applied, duplicate } };
    } catch (err) {
      return { success: false, error: { code: "DRAFT_FAILED", message: err instanceof Error ? err.message : "Draft failed" } };
    }
  }
);

register(
  "confirm_order",
  "Confirm a draft order. Only call after the customer explicitly confirmed. Transactional + idempotent.",
  { type: "object", properties: { order_id: { type: "string" }, idempotency_key: { type: "string" } }, required: ["order_id", "idempotency_key"] },
  z.object({ order_id: z.string().min(1), idempotency_key: z.string().min(4).max(120) }),
  async (ctx, args) => {
    const a = args as { order_id: string; idempotency_key: string };
    try {
      const { order, duplicate } = await confirmOrder({ tenantId: ctx.tenantId, orderId: a.order_id, idempotencyKey: a.idempotency_key, actor: ctx.actor ?? "ai" });
      return { success: true, data: { order_id: order.id, number: (order as { number?: number }).number ?? null, total: order.total, status: order.status, duplicate } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Confirm failed";
      const code = msg.startsWith("INSUFFICIENT_STOCK")
        ? "INSUFFICIENT_STOCK"
        : msg === "PHONE_NOT_VERIFIED"
          ? "PHONE_NOT_VERIFIED"
          : "CONFIRM_FAILED";
      return { success: false, error: { code, message: msg } };
    }
  }
);

register(
  "send_verification_code",
  "Send an SMS verification code for a draft order (COD fake-order protection). Call when confirm fails with PHONE_NOT_VERIFIED.",
  { type: "object", properties: { order_id: { type: "string" } }, required: ["order_id"] },
  z.object({ order_id: z.string().min(1) }),
  async (ctx, args) => {
    const a = args as { order_id: string };
    const order = await prisma.order.findFirst({ where: { id: a.order_id, tenantId: ctx.tenantId } });
    if (!order) return { success: false, error: { code: "NOT_FOUND", message: "Order not found" } };
    if (!["DRAFT", "PENDING_CONFIRMATION"].includes(order.status)) {
      return { success: false, error: { code: "INVALID_STATE", message: `Order is ${order.status}` } };
    }
    if (!order.customerPhone) return { success: false, error: { code: "NO_PHONE", message: "Order has no phone number" } };
    const tenant = await prisma.tenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true } });
    const { sendVerificationCode, VerifyError } = await import("../verify");
    try {
      const r = await sendVerificationCode({ tenantId: ctx.tenantId, phone: order.customerPhone, orderId: order.id, shopName: tenant?.name ?? "the store" });
      await prisma.order.update({ where: { id: order.id }, data: { status: "PENDING_CONFIRMATION" } }).catch(() => {});
      return { success: true, data: { sent: r.sent, cooldownMs: r.cooldownMs } };
    } catch (err) {
      if (err instanceof VerifyError) return { success: false, error: { code: "SEND_FAILED", message: err.message } };
      return { success: false, error: { code: "SEND_FAILED", message: "Could not send code" } };
    }
  }
);

register(
  "verify_phone_code",
  "Check the SMS code the customer typed for a draft order. On success the order may be confirmed.",
  { type: "object", properties: { order_id: { type: "string" }, code: { type: "string" } }, required: ["order_id", "code"] },
  z.object({ order_id: z.string().min(1), code: z.string().min(4).max(8) }),
  async (ctx, args) => {
    const a = args as { order_id: string; code: string };
    const order = await prisma.order.findFirst({ where: { id: a.order_id, tenantId: ctx.tenantId } });
    if (!order) return { success: false, error: { code: "NOT_FOUND", message: "Order not found" } };
    const { checkVerificationCode, VerifyError } = await import("../verify");
    try {
      await checkVerificationCode({ tenantId: ctx.tenantId, orderId: order.id, code: a.code });
      return { success: true, data: { verified: true } };
    } catch (err) {
      if (err instanceof VerifyError) return { success: false, error: { code: err.kind.toUpperCase(), message: err.message } };
      return { success: false, error: { code: "VERIFY_FAILED", message: "Verification failed" } };
    }
  }
);

register(
  "cancel_order",
  "Cancel a draft/pending order.",
  { type: "object", properties: { order_id: { type: "string" } }, required: ["order_id"] },
  z.object({ order_id: z.string().min(1) }),
  async (ctx, args) => {
    const a = args as { order_id: string };
    try {
      const order = await cancelOrder({ tenantId: ctx.tenantId, orderId: a.order_id, actor: ctx.actor ?? "ai" });
      return { success: true, data: { order_id: order.id, status: order.status } };
    } catch (err) {
      return { success: false, error: { code: "CANCEL_FAILED", message: err instanceof Error ? err.message : "Cancel failed" } };
    }
  }
);

register(
  "get_order",
  "Get an order with items and status timeline.",
  { type: "object", properties: { order_id: { type: "string" } }, required: ["order_id"] },
  z.object({ order_id: z.string().min(1) }),
  async (ctx, args) => {
    const a = args as { order_id: string };
    const order = await prisma.order.findFirst({
      where: { id: a.order_id, tenantId: ctx.tenantId },
      include: { items: true, history: { orderBy: { createdAt: "asc" } } },
    });
    if (!order) return { success: false, error: { code: "NOT_FOUND", message: "Order not found" } };
    return { success: true, data: order };
  }
);

register(
  "search_business_knowledge",
  "Search unstructured business knowledge (policies, FAQs, guides). Never use for prices/stock.",
  { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  z.object({ query: z.string().min(1).max(500) }),
  async (ctx, args) => {
    const a = args as { query: string };
    const hits = await retrieveKnowledge(ctx.tenantId, a.query, 4);
    return { success: true, data: { passages: hits.map((h) => ({ title: h.title, content: h.content, score: h.score })) } };
  }
);

register(
  "request_human",
  "Escalate the conversation to a human agent.",
  { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
  z.object({ reason: z.string().min(1).max(500) }),
  async (ctx, args) => {
    const a = args as { reason: string };
    await requestHuman(ctx.tenantId, ctx.conversationId, a.reason);
    return { success: true, data: { escalated: true } };
  }
);

register(
  "get_product_variants",
  "List active variants with live stock for one product. Use for size/color availability questions.",
  { type: "object", properties: { product_id: { type: "string" } }, required: ["product_id"] },
  z.object({ product_id: z.string().min(1) }),
  async (ctx, args) => {
    const a = args as { product_id: string };
    const p = await getProductWithVariants(ctx.tenantId, a.product_id);
    if (!p) return { success: false, error: { code: "NOT_FOUND", message: "Product not found" } };
    return {
      success: true,
      data: {
        product_id: p.id,
        variants: p.variants
          .filter((v) => v.active)
          .map((v) => ({
            variant_id: v.id,
            sku: v.sku,
            price: v.price ?? p.basePrice,
            attributes: v.attributes,
            label: variantLabel((v.attributes as Record<string, string>) ?? {}),
            stock: v.inventory?.quantity ?? 0,
          })),
      },
    };
  }
);

register(
  "get_customer",
  "Get the CURRENT conversation's customer profile (orders, language). Can only ever return the caller's own record — never another customer.",
  { type: "object", properties: {} },
  z.object({}),
  async (ctx) => {
    if (!ctx.customerId) return { success: false, error: { code: "NO_CUSTOMER", message: "No customer on this conversation" } };
    const c = await prisma.customer.findFirst({
      where: { id: ctx.customerId, tenantId: ctx.tenantId },
      select: { id: true, name: true, phone: true, preferredLanguage: true, totalOrders: true, totalSpent: true },
    });
    if (!c) return { success: false, error: { code: "NOT_FOUND", message: "Customer not found" } };
    return { success: true, data: c };
  }
);

register(
  "update_order_draft",
  "Modify the conversation's open draft: add/remove lines, set quantity, address, zone, or payment. Only DRAFT/PENDING drafts.",
  {
    type: "object",
    properties: {
      order_id: { type: "string" },
      action: { type: "string", enum: ["add", "remove", "set_quantity", "set_address", "set_zone", "set_payment"] },
      variant_id: { type: "string" },
      quantity: { type: "number" },
      address: { type: "string" },
      delivery_zone_id: { type: "string" },
      payment_method: { type: "string" },
    },
    required: ["order_id", "action"],
  },
  z.object({
    order_id: z.string().min(1),
    action: z.enum(["add", "remove", "set_quantity", "set_address", "set_zone", "set_payment"]),
    variant_id: z.string().optional(),
    quantity: z.number().int().min(1).max(99).optional(),
    address: z.string().max(1000).optional(),
    delivery_zone_id: z.string().optional(),
    payment_method: z.enum(["CASH_ON_DELIVERY", "BANK_TRANSFER", "PAYMENT_LINK", "MANUAL"]).optional(),
  }),
  async (ctx, args) => {
    const a = args as {
      order_id: string;
      action: "add" | "remove" | "set_quantity" | "set_address" | "set_zone" | "set_payment";
      variant_id?: string; quantity?: number; address?: string; delivery_zone_id?: string;
      payment_method?: "CASH_ON_DELIVERY" | "BANK_TRANSFER" | "PAYMENT_LINK" | "MANUAL";
    };
    const order = await prisma.order.findFirst({ where: { id: a.order_id, tenantId: ctx.tenantId }, include: { items: true } });
    if (!order) return { success: false, error: { code: "NOT_FOUND", message: "Order not found" } };
    if (!["DRAFT", "PENDING_CONFIRMATION"].includes(order.status)) {
      return { success: false, error: { code: "INVALID_STATE", message: `Draft is ${order.status}, cannot modify` } };
    }
    try {
      if (a.action === "set_address" && a.address !== undefined) {
        await prisma.order.update({ where: { id: order.id }, data: { address: a.address } });
      } else if (a.action === "set_zone" && a.delivery_zone_id) {
        const zone = await prisma.deliveryZone.findFirst({ where: { id: a.delivery_zone_id, tenantId: ctx.tenantId, active: true } });
        if (!zone) return { success: false, error: { code: "ZONE_NOT_SERVED", message: "Unknown delivery zone" } };
        const tenant = await prisma.tenant.findUnique({ where: { id: ctx.tenantId } });
        const totals = calculateTotals({
          lines: order.items,
          deliveryFee: zone.fee,
          freeDeliveryThreshold: tenant?.freeDeliveryThreshold,
          taxRate: tenant?.taxRate ?? undefined,
        });
        await prisma.order.update({ where: { id: order.id }, data: { deliveryZoneId: zone.id, deliveryFee: totals.deliveryFee, total: totals.total, tax: totals.tax } });
      } else if (a.action === "set_payment" && a.payment_method) {
        await prisma.order.update({ where: { id: order.id }, data: { paymentMethod: a.payment_method } });
      } else if ((a.action === "add" || a.action === "set_quantity" || a.action === "remove") && a.variant_id) {
        const variant = await prisma.productVariant.findFirst({
          where: { id: a.variant_id, tenantId: ctx.tenantId, active: true },
          include: { product: true },
        });
        if (!variant || !variant.product.active) return { success: false, error: { code: "VARIANT_UNAVAILABLE", message: "Variant unavailable" } };
        const unitPrice = variant.price ?? variant.product.basePrice;
        const existing = order.items.find((i) => i.variantId === a.variant_id);
        if (a.action === "remove" || (a.action === "set_quantity" && (a.quantity ?? 0) <= 0)) {
          if (existing) await prisma.orderItem.delete({ where: { id: existing.id } });
        } else {
          const qty = a.action === "add" ? (existing ? existing.quantity + (a.quantity ?? 1) : (a.quantity ?? 1)) : (a.quantity ?? 1);
          if (qty < 1 || qty > 99) return { success: false, error: { code: "INVALID_QTY", message: "Quantity 1..99" } };
          if (existing) {
            await prisma.orderItem.update({ where: { id: existing.id }, data: { quantity: qty, unitPrice, lineTotal: unitPrice * qty } });
          } else {
            await prisma.orderItem.create({
              data: {
                tenantId: ctx.tenantId,
                orderId: order.id,
                productId: variant.productId,
                variantId: variant.id,
                productName: variant.product.name,
                variantLabel: variantLabel((variant.attributes as Record<string, string>) ?? {}),
                sku: variant.sku,
                unitPrice,
                quantity: qty,
                lineTotal: unitPrice * qty,
              },
            });
          }
        }
        // Re-total from backend pricing (never trust model math).
        const refreshed = await prisma.order.findFirst({ where: { id: order.id }, include: { items: true } });
        const tenant = await prisma.tenant.findUnique({ where: { id: ctx.tenantId } });
        const zone = refreshed?.deliveryZoneId
          ? await prisma.deliveryZone.findFirst({ where: { id: refreshed.deliveryZoneId, tenantId: ctx.tenantId } })
          : null;
        const totals = calculateTotals({
          lines: (refreshed?.items ?? []).map((i) => ({ unitPrice: i.unitPrice, quantity: i.quantity })),
          deliveryFee: zone?.fee ?? refreshed?.deliveryFee ?? 0,
          freeDeliveryThreshold: tenant?.freeDeliveryThreshold,
          taxRate: tenant?.taxRate ?? undefined,
        });
        await prisma.order.update({
          where: { id: order.id },
          data: { subtotal: totals.subtotal, discount: totals.discount, deliveryFee: totals.deliveryFee, tax: totals.tax, total: totals.total },
        });
      } else {
        return { success: false, error: { code: "INVALID_ARGS", message: "Action needs its field (variant_id/quantity/address/...)" } };
      }
      const updated = await prisma.order.findFirst({ where: { id: order.id }, include: { items: true } });
      return { success: true, data: { order_id: order.id, subtotal: updated?.subtotal, delivery_fee: updated?.deliveryFee, total: updated?.total, items: updated?.items.length } };
    } catch (err) {
      return { success: false, error: { code: "UPDATE_FAILED", message: err instanceof Error ? err.message.slice(0, 200) : "Update failed" } };
    }
  }
);

register(
  "get_order_status",
  "Get status + timeline for an order in this tenant (safe subset of get_order).",
  { type: "object", properties: { order_id: { type: "string" } }, required: ["order_id"] },
  z.object({ order_id: z.string().min(1) }),
  async (ctx, args) => {
    const a = args as { order_id: string };
    const order = await prisma.order.findFirst({
      where: { id: a.order_id, tenantId: ctx.tenantId },
      select: { id: true, number: true, status: true, total: true, history: { orderBy: { createdAt: "asc" } } },
    });
    if (!order) return { success: false, error: { code: "NOT_FOUND", message: "Order not found" } };
    return { success: true, data: order };
  }
);

register(
  "recommend_size",
  "Recommend a size from the product's real measurement table. Advisory only: present as a suggestion and confirm. Never invent numbers.",
  {
    type: "object",
    properties: {
      product_id: { type: "string" },
      chest_cm: { type: "number" },
      height_cm: { type: "number" },
      weight_kg: { type: "number" },
      fit: { type: "string", enum: ["slim", "regular", "oversized"] },
    },
    required: ["product_id"],
  },
  z.object({
    product_id: z.string().min(1),
    chest_cm: z.number().min(50).max(200).optional(),
    height_cm: z.number().min(100).max(230).optional(),
    weight_kg: z.number().min(30).max(300).optional(),
    fit: z.enum(["slim", "regular", "oversized"]).optional(),
  }),
  async (ctx, args) => {
    const a = args as { product_id: string; chest_cm?: number; height_cm?: number; weight_kg?: number; fit?: FitPreference };
    try {
      const rows = await getMeasurements(ctx.tenantId, a.product_id);
      if (rows.length === 0) {
        return { success: true, data: { recommendations: [], method: "table", confidence: "none", note: "No measurement table for this product" } };
      }
      const out = rankSizes(rows, { chestCm: a.chest_cm, heightCm: a.height_cm, weightKg: a.weight_kg, fit: a.fit });
      return {
        success: true,
        data: {
          ...out,
          table: rows.map((r) => ({ size: r.size, chest: r.chest, length: r.length, shoulder: r.shoulder, sleeve: r.sleeve })),
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "recommend failed";
      return { success: false, error: { code: msg === "PRODUCT_NOT_FOUND" ? "NOT_FOUND" : "RECOMMEND_FAILED", message: msg } };
    }
  }
);

register(
  "remember_customer_size",
  "Save the CURRENT conversation's confirmed clothing size (explicit opt-in only, e.g. 'my size is always L'). Self record only.",
  { type: "object", properties: { size: { type: "string" } }, required: ["size"] },
  z.object({ size: z.string().min(1).max(10) }),
  async (ctx, args) => {
    const a = args as { size: string };
    if (!ctx.customerId) return { success: false, error: { code: "NO_CUSTOMER", message: "No customer on this conversation" } };
    const size = a.size.trim().toUpperCase().slice(0, 10);
    if (!/^[A-Z0-9]{1,6}$/.test(size)) return { success: false, error: { code: "INVALID_SIZE", message: "Size must be a short code like S/M/L/XL" } };
    const c = await prisma.customer.findFirst({ where: { id: ctx.customerId, tenantId: ctx.tenantId } });
    if (!c) return { success: false, error: { code: "NOT_FOUND", message: "Customer not found" } };
    await prisma.customer.update({ where: { id: c.id }, data: { preferredSize: size } });
    return { success: true, data: { size } };
  }
);
