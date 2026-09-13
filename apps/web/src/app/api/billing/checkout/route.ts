import { Errors, ok, fail } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";
import { startCheckout } from "@/server/billing/payments";

export async function POST(req: Request) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "OWNER");
  } catch {
    return Errors.forbidden(requestId);
  }
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const planSlug = typeof body.planSlug === "string" && body.planSlug ? body.planSlug : "growth";
  const result = await startCheckout({
    tenantId: s.tenantId,
    planSlug,
    owner: { userId: s.userId, email: s.email, phone: typeof body.phone === "string" ? body.phone : undefined },
  });
  if ("error" in result) {
    const status = result.error === "billing_not_configured" ? 501 : 400;
    return fail(result.error.toUpperCase(), result.error, { status, requestId });
  }
  return ok({ url: result.url }, { requestId });
}