import { Errors, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";
import { updateVariant } from "@/server/products";
import { audit } from "@/server/audit";
import { z } from "zod";

const patchSchema = z.object({
  price: z.number().int().min(0).max(100000000).nullable().optional(),
  attributes: z.record(z.string().min(1).max(60), z.string().min(1).max(120)).optional(),
  active: z.boolean().optional(),
});

/** Edit price / attributes / active flag. SKU is immutable identity. Stock changes go through /api/inventory. */
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
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return Errors.validation(requestId, parsed.error.flatten());
  try {
    const variant = await updateVariant(s.tenantId, params.id, parsed.data);
    await audit({ tenantId: s.tenantId, actor: `user:${s.userId}`, action: "variant.updated", resource: "variant", resourceId: variant.id, newValue: parsed.data });
    return ok({ variant }, { requestId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Update failed";
    if (msg === "VARIANT_NOT_FOUND") return Errors.notFound(requestId, "Variant");
    return Errors.validation(requestId, msg);
  }
}
