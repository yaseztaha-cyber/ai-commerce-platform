import { Errors, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession } from "@/server/auth";
import { billingStatus } from "@/server/billing/payments";

export async function GET() {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  const data = await billingStatus(s.tenantId);
  return ok(data, { requestId });
}