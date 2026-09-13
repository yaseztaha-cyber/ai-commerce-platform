import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/server/auth";
import { prisma } from "@ai-commerce/database";
import { createShipment, ShippingError } from "@/server/shipping";
import { audit } from "@/server/audit";
import { rateLimit } from "@/lib/rate-limit";

/**
 * POST /api/shipping/book-pickup
 * Book a courier pickup for an order (owner/admin only).
 * Body: { orderId: string }
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = rateLimit(`pickup:${session.tenantId}`, 5, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });

  const { searchParams } = new URL(req.url);
  const orderId = searchParams.get("orderId");
  if (!orderId) return NextResponse.json({ error: "orderId required" }, { status: 400 });

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { tenant: true, items: { include: { variant: { include: { product: true } } } } },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.tenantId !== session.tenantId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Only allow booking from READY status (after CONFIRMED -> PROCESSING -> READY)
  const allowed = ["READY", "CONFIRMED", "PROCESSING"];
  if (!allowed.includes(order.status)) {
    return NextResponse.json({ error: `Order must be in ${allowed.join(", ")} status` }, { status: 400 });
  }

  // Validate required fields for shipping
  if (!order.customerName || !order.customerPhone || !order.address) {
    return NextResponse.json({ error: "Order missing customer name, phone, or address" }, { status: 400 });
  }

  try {
    // Calculate COD amount (total in minor units)
    const codAmount = order.total;

    const result = await createShipment({
      orderNumber: order.number,
      name: order.customerName,
      phone: order.customerPhone,
      address: order.address,
      city: "Cairo",
      notes: order.notes ?? undefined,
      codAmount,
      weightGrams: order.items.reduce((sum, i) => sum + (i.quantity * 200), 500), // estimate 200g per item
    });

    // Update order with tracking info
    await prisma.order.update({
      where: { id: orderId },
      data: {
        trackingNumber: result.trackingNumber,
        trackingUrl: result.labelUrl,
        courier: "bosta",
        courierPayload: result.raw as never,
        status: "READY",
      },
    });

    await audit({
      tenantId: session.tenantId,
      actor: `user:${session.userId}`,
      action: "SHIPMENT_BOOKED",
      resource: "Order",
      resourceId: orderId,
      newValue: { trackingNumber: result.trackingNumber, courier: "bosta" },
    });

    return NextResponse.json({ trackingNumber: result.trackingNumber, labelUrl: result.labelUrl });
  } catch (err: unknown) {
    if (err instanceof ShippingError) {
      return NextResponse.json({ error: err.message, kind: err.kind }, { status: err.kind === "disabled" ? 503 : 400 });
    }
    console.error("Book pickup failed:", err);
    return NextResponse.json({ error: "Failed to book pickup" }, { status: 500 });
  }
}