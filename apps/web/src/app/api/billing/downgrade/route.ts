import { Errors, ok, fail } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";
import { downgradePlan } from "@/server/billing";

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
  if (typeof body.planSlug !== "string" || !body.planSlug) return Errors.validation(requestId, "planSlug is required");
  const result = await downgradePlan(s.tenantId, body.planSlug, `user:${s.userId}`);
  if (!result.ok) {
    const message =
      result.error === "same_plan"
        ? "Already on this plan"
        : result.error === "not_downgrade"
          ? "Upgrades go through checkout"
          : "Unknown plan";
    return fail(result.error.toUpperCase(), message, { status: 400, requestId });
  }
  return ok({ subscription: result.subscription }, { requestId });
}
