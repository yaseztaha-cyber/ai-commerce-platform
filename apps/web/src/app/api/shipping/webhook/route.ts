import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@ai-commerce/database";
import { handleShippingWebhook, mapCourierStatusToOrderStatus } from "@/server/shipping";
import { audit } from "@/server/audit";
import { notifyCustomer } from "@/server/notifications";

/**
 * POST /api/shipping/webhook
 * Bosta tracking webhook (HMAC verified).
 * Maps courier statuses to order transitions and notifies customer.
 */
export async function POST(req: NextRequest) {
  const signature = req.headers.get("x-bosta-signature") ?? req.headers.get("x-signature") ?? "";
  const rawBody = await req.text();

  let trackingEvent;
  try {
    trackingEvent = handleShippingWebhook(rawBody, signature);
  } catch (err) {
    console.warn("Shipping webhook verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (!trackingEvent) {
    // Unknown event type, acknowledge but don't process
    return NextResponse.json({ received: true, processed: false });
  }

  const { trackingNumber, status: courierStatus, raw } = trackingEvent;
  const newOrderStatus = mapCourierStatusToOrderStatus(courierStatus);
  if (!newOrderStatus) {
    return NextResponse.json({ received: true, processed: false, reason: "Unmapped status" });
  }

  // Find order by tracking number
  const order = await prisma.order.findFirst({
    where: { trackingNumber, courier: "bosta" },
    include: { tenant: true },
  });

  if (!order) {
    console.warn("Webhook for unknown tracking number", { trackingNumber });
    return NextResponse.json({ received: true, processed: false, reason: "Order not found" });
  }

  // Validate transition
  const { canTransitionOrder } = await import("@ai-commerce/shared");
  if (!canTransitionOrder(order.status as any, newOrderStatus as any)) {
    console.warn("Invalid status transition", { orderId: order.id, from: order.status, to: newOrderStatus });
    return NextResponse.json({ received: true, processed: false, reason: "Invalid transition" });
  }

  // Update order status
  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: newOrderStatus,
        deliveryStatus: newOrderStatus,
        courierPayload: { ...((order.courierPayload as Record<string, unknown>) ?? {}), lastWebhook: raw } as never,
      },
    });

    await tx.orderStatusHistory.create({
      data: {
        tenantId: order.tenantId,
        orderId: order.id,
        oldStatus: order.status,
        newStatus: newOrderStatus,
        actor: "system:bosta",
        reason: `Courier webhook: ${courierStatus}`,
      },
    });
  });

  // Notify customer via WhatsApp
  await notifyCustomer(
    order.tenantId,
    order.customerId!,
    `أوردر #${order.number}: حالة الشحن ${newOrderStatus === "COMPLETED" ? "تم التسليم" : newOrderStatus === "OUT_FOR_DELIVERY" ? "خرج للتوصيل" : newOrderStatus === "RETURNED" ? "مرتجع" : "تحديث"}. تتبع: ${trackingNumber}`
  ).catch((e) => console.warn("Notify customer failed:", e));

  await audit({
    tenantId: order.tenantId,
    actor: "system:bosta",
    action: "ORDER_STATUS_WEBHOOK",
    resource: "Order",
    resourceId: order.id,
    newValue: { courierStatus, newOrderStatus, trackingNumber },
  });

  return NextResponse.json({ received: true, processed: true, newStatus: newOrderStatus });
}