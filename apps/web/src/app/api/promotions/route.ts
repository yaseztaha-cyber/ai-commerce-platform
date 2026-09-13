import { prisma } from "@ai-commerce/database";
import { Errors, fail, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";
import { createPromotion, deletePromotion, validatePromotion } from "@/server/promotions";
import { z } from "zod";

const promoSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(["PERCENT", "FIXED", "BXGY", "FREE_SHIPPING"]),
  value: z.number().int().min(0).max(100000000).default(0),
  minSubtotal: z.number().int().min(0).max(100000000).nullable().optional(),
  productIds: z.array(z.string().min(1)).max(100).optional(),
  buyQty: z.number().int().min(1).max(99).nullable().optional(),
  getQty: z.number().int().min(1).max(99).nullable().optional(),
  startAt: z.string().datetime().nullable().optional(),
  endAt: z.string().datetime().nullable().optional(),
  active: z.boolean().optional(),
  usageLimit: z.number().int().min(1).max(1000000).nullable().optional(),
});

export async function GET() {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  const promotions = await prisma.promotion.findMany({ where: { tenantId: s.tenantId }, orderBy: { createdAt: "desc" }, take: 100 });
  return ok({ promotions }, { requestId });
}

export async function POST(req: Request) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "MANAGER");
  } catch {
    return Errors.forbidden(requestId);
  }
  const body = await req.json().catch(() => null);
  const parsed = promoSchema.safeParse(body);
  if (!parsed.success) return Errors.validation(requestId, parsed.error.flatten());
  const p = parsed.data;
  const businessErr = validatePromotion({
    name: p.name,
    kind: p.kind,
    value: p.value,
    minSubtotal: p.minSubtotal,
    productIds: p.productIds,
    buyQty: p.buyQty,
    getQty: p.getQty,
    startAt: p.startAt ? new Date(p.startAt) : null,
    endAt: p.endAt ? new Date(p.endAt) : null,
    active: p.active,
    usageLimit: p.usageLimit,
  });
  if (businessErr) return fail("INVALID_PROMOTION", businessErr, { status: 422, requestId });
  try {
    const promo = await createPromotion(
      s.tenantId,
      {
        name: p.name,
        kind: p.kind,
        value: p.value,
        minSubtotal: p.minSubtotal,
        productIds: p.productIds,
        buyQty: p.buyQty,
        getQty: p.getQty,
        startAt: p.startAt ? new Date(p.startAt) : null,
        endAt: p.endAt ? new Date(p.endAt) : null,
        active: p.active,
        usageLimit: p.usageLimit,
      },
      `user:${s.userId}`
    );
    return ok({ promotion: promo }, { requestId, status: 201 });
  } catch (err) {
    return fail("CREATE_FAILED", err instanceof Error ? err.message : "Create failed", { status: 400, requestId });
  }
}

export async function DELETE(req: Request) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "MANAGER");
  } catch {
    return Errors.forbidden(requestId);
  }
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return Errors.validation(requestId, "id required");
  try {
    return ok(await deletePromotion(s.tenantId, id, `user:${s.userId}`), { requestId });
  } catch {
    return Errors.notFound(requestId, "Promotion");
  }
}
