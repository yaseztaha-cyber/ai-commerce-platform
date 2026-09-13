import { prisma } from "@ai-commerce/database";
import { Errors, fail, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";
import { amendOrder } from "@/server/orders";
import { z } from "zod";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  const order = await prisma.order.findFirst({
    where: { id: params.id, tenantId: s.tenantId },
    include: { items: true, history: { orderBy: { createdAt: "asc" } }, customer: true },
  });
  if (!order) return Errors.notFound(requestId, "Order");
  return ok({ order }, { requestId });
}

const amendSchema = z.object({
  address: z.string().max(1000).optional(),
  customerName: z.string().max(200).optional(),
  customerPhone: z.string().max(40).optional(),
  notes: z.string().max(2000).optional(),
  items: z.array(z.object({ variantId: z.string().min(1), quantity: z.number().int().min(1).max(99) })).min(1).max(20).optional(),
});

/** Dashboard-only amendment of a live order (MANAGER+). The AI never calls this. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "MANAGER");
  } catch {
    return Errors.forbidden(requestId);
  }
  const body = await req.json().catch(() => null);
  const parsed = amendSchema.safeParse(body);
  if (!parsed.success) return Errors.validation(requestId, parsed.error.flatten());
  try {
    const order = await amendOrder({ tenantId: s.tenantId, orderId: params.id, actor: `user:${s.userId}`, ...parsed.data });
    return ok({ order }, { requestId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Amend failed";
    if (msg === "ORDER_NOT_FOUND") return Errors.notFound(requestId, "Order");
    if (msg.startsWith("INVALID_STATE")) return fail("INVALID_STATE", msg, { status: 409, requestId });
    if (msg.startsWith("INSUFFICIENT_STOCK")) return fail("INSUFFICIENT_STOCK", msg, { status: 409, requestId });
    return Errors.validation(requestId, msg);
  }
}
