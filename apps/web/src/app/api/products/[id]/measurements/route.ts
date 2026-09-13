import { Errors, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";
import { deleteMeasurement, getMeasurements, upsertMeasurement } from "@/server/sizing";
import { audit } from "@/server/audit";
import { z } from "zod";

const measureSchema = z.object({
  size: z.string().min(1).max(20),
  chest: z.number().min(0).max(300).nullable().optional(),
  length: z.number().min(0).max(300).nullable().optional(),
  shoulder: z.number().min(0).max(300).nullable().optional(),
  sleeve: z.number().min(0).max(300).nullable().optional(),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    return ok({ measurements: await getMeasurements(s.tenantId, params.id) }, { requestId });
  } catch {
    return Errors.notFound(requestId, "Product");
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "MANAGER");
  } catch {
    return Errors.forbidden(requestId);
  }
  const body = await req.json().catch(() => null);
  const parsed = measureSchema.safeParse(body);
  if (!parsed.success) return Errors.validation(requestId, parsed.error.flatten());
  try {
    const row = await upsertMeasurement(s.tenantId, params.id, parsed.data, `user:${s.userId}`);
    await audit({ tenantId: s.tenantId, actor: `user:${s.userId}`, action: "product.measurement_upserted", resource: "product", resourceId: params.id, newValue: parsed.data });
    return ok({ measurement: row }, { requestId, status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Upsert failed";
    if (msg === "PRODUCT_NOT_FOUND") return Errors.notFound(requestId, "Product");
    return Errors.validation(requestId, msg);
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "MANAGER");
  } catch {
    return Errors.forbidden(requestId);
  }
  const size = new URL(req.url).searchParams.get("size") ?? "";
  if (!size) return Errors.validation(requestId, "size required");
  try {
    return ok(await deleteMeasurement(s.tenantId, params.id, size), { requestId });
  } catch {
    return Errors.notFound(requestId, "Measurement");
  }
}
