import { Errors, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession } from "@/server/auth";
import { overviewAnalytics } from "@/server/analytics";

export async function GET() {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  const data = await overviewAnalytics(s.tenantId);
  return ok(data, { requestId });
}
