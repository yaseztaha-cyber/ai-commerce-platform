import { prisma } from "@ai-commerce/database";
import { Errors, fail, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";
import { transitionOrder } from "@/server/orders";
import { adjustStock } from "@/server/inventory";
import { ORDER_STATUSES } from "@ai-commerce/shared";
import { z } from "zod";

const STOCK_HOLDING = ["CONFIRMED", "PROCESSING", "READY", "OUT_FOR_DELIVERY", "COMPLETED"];

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "AGENT");
  } catch {
    return Errors.forbidden(requestId);
  }
  const body = await req.json().catch(() => null);
  const parsed = z.object({ to: z.enum(ORDER_STATUSES as unknown as [string, ...string[]]), reason: z.string().max(500).optional(), restock: z.boolean().optional() }).safeParse(body);
  if (!parsed.success) return Errors.validation(requestId, parsed.error.flatten());
  try {
    const before = await prisma.order.findFirst({ where: { id: ctx.params.id, tenantId: s.tenantId }, include: { items: true } });
    if (!before) return Errors.notFound(requestId, "Order");
    const order = await transitionOrder({ tenantId: s.tenantId, orderId: ctx.params.id, to: parsed.data.to as never, actor: `user:${s.userId}`, reason: parsed.data.reason });
    // Returns/cancellations can put reserved stock back, with movements.
    if (parsed.data.restock && ["CANCELLED", "RETURNED"].includes(parsed.data.to) && STOCK_HOLDING.includes(before.status)) {
      for (const item of before.items) {
        await adjustStock({ tenantId: s.tenantId, variantId: item.variantId, delta: item.quantity, type: "RETURN", reason: `${parsed.data.to.toLowerCase()} order #${before.number} (restock)`, actor: `user:${s.userId}`, orderId: before.id });
      }
    }
    return ok({ order }, { requestId });
  } catch (err) {
    return fail("TRANSITION_FAILED", err instanceof Error ? err.message : "Transition failed", { status: 400, requestId });
  }
}
