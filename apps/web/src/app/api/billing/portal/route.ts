import { Errors, ok, fail } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";
import { getSubscription } from "@/server/billing";
import { startCheckout } from "@/server/billing/payments";

export async function POST() {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "OWNER");
  } catch {
    return Errors.forbidden(requestId);
  }
  const sub = await getSubscription(s.tenantId);
  const result = await startCheckout({ tenantId: s.tenantId, planSlug: sub.plan.slug, owner: { userId: s.userId, email: s.email } });
  if ("error" in result) {
    const status = result.error === "billing_not_configured" ? 501 : 400;
    return fail(result.error.toUpperCase(), result.error, { status, requestId });
  }
  return ok({ url: result.url }, { requestId });
}