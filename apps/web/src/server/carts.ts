import { prisma } from "@ai-commerce/database";
import { logger } from "@/lib/logger";
import { whatsappProvider } from "./messaging/whatsapp";
import { ConsoleMessagingProvider } from "./messaging/types";

export interface NudgeSender {
  send(tenantId: string, channel: string, to: string, text: string): Promise<{ ok: boolean; channel: string; error?: string }>;
}

async function defaultSend(tenantId: string, channel: string, to: string, text: string) {
  if (channel === "WHATSAPP") {
    const res = await whatsappProvider.send(tenantId, { to, text });
    return { ok: res.success, channel: "WHATSAPP" as const, error: res.success ? undefined : (res.error ?? "send failed") };
  }
  await new ConsoleMessagingProvider().send(tenantId, { to, text });
  return { ok: true, channel: "CONSOLE" as const };
}

function cartSummary(items: Array<{ productName: string; variantLabel: string; quantity: number }>, total: number, currency: string): string {
  const lines = items.map((i) => `• ${i.productName} ${i.variantLabel} ×${i.quantity}`).join("\n");
  return `لسه شايلين الأوردر بتاعك 🛒\n${lines}\nالإجمالي ${total} ${currency}\nتحب نكمله؟ رد عليا وأنا معاك.`;
}

/**
 * One polite reminder per stale draft. A draft qualifies iff ALL hold:
 * - status DRAFT/PENDING_CONFIRMATION, customer phone present
 * - tenant cart nudges enabled (cartNudgeHours set)
 * - untouched longer than cartNudgeHours
 * - customer did NOT message after the last draft touch (any reply cancels)
 * - no CART_NUDGE notification recorded for this order yet
 * - marketing consent not explicitly revoked
 */
export async function sweepAbandonedCarts(
  now = new Date(),
  opts?: { limit?: number; send?: NudgeSender["send"] }
): Promise<{ nudged: number; skipped: number }> {
  const limit = Math.max(1, Math.min(200, opts?.limit ?? 100));
  const send = opts?.send ?? defaultSend;
  const candidates = await prisma.order.findMany({
    where: { status: { in: ["DRAFT", "PENDING_CONFIRMATION"] }, customerPhone: { not: null } },
    include: {
      items: true,
      tenant: { select: { id: true, currency: true, cartNudgeHours: true } },
      customer: { select: { marketingConsent: true } },
      conversation: { select: { id: true, channel: true, externalId: true } },
    },
    orderBy: { updatedAt: "asc" },
    take: limit * 2,
  });

  let nudged = 0;
  let skipped = 0;
  for (const order of candidates) {
    if (nudged >= limit) break;
    const hours = order.tenant.cartNudgeHours;
    if (hours == null || hours <= 0) {
      skipped++;
      continue;
    }
    if (order.updatedAt.getTime() > now.getTime() - hours * 3600 * 1000) {
      skipped++;
      continue;
    }
    if (order.customer?.marketingConsent === false) {
      skipped++;
      continue;
    }
    if (!order.conversationId || !order.conversation) {
      skipped++;
      continue;
    }
    const newerCustomerMsg = await prisma.message.findFirst({
      where: { conversationId: order.conversationId, role: "customer", createdAt: { gt: order.updatedAt } },
      select: { id: true },
    });
    if (newerCustomerMsg) {
      skipped++;
      continue;
    }
    const already = await prisma.notification.findFirst({
      where: { tenantId: order.tenantId, kind: "CART_NUDGE", target: order.id, status: "SENT" },
      select: { id: true },
    });
    if (already) {
      skipped++;
      continue;
    }
    // Permanently failing numbers stop being retried after 3 attempts (no table spam, no infinite loop).
    const failures = await prisma.notification.count({
      where: { tenantId: order.tenantId, kind: "CART_NUDGE", target: order.id, status: "FAILED" },
    });
    if (failures >= 3) {
      skipped++;
      continue;
    }
    const phone = order.customerPhone!;
    const ext = order.conversation.externalId ?? "";
    const to = ext.includes(":") ? ext.split(":").slice(1).join(":") : phone;
    const text = cartSummary(order.items, order.total, order.tenant.currency);
    let ok = false;
    let channel = order.conversation.channel;
    let error: string | undefined;
    try {
      const res = await send(order.tenantId, order.conversation.channel, to, text);
      ok = res.ok;
      channel = res.channel;
      error = res.error;
    } catch (err) {
      error = err instanceof Error ? err.message.slice(0, 300) : "send failed";
    }
    await prisma.notification.create({
      data: {
        tenantId: order.tenantId,
        kind: "CART_NUDGE",
        channel,
        target: order.id,
        payload: { items: order.items.length, total: order.total } as never,
        status: ok ? "SENT" : "FAILED",
        error,
      },
    });
    if (ok) {
      nudged++;
      logger.info("cart nudge sent", { tenantId: order.tenantId, orderId: order.id });
    } else {
      skipped++;
      logger.warn("cart nudge failed", { tenantId: order.tenantId, orderId: order.id, error });
    }
  }
  return { nudged, skipped };
}
