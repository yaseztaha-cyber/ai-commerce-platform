import { Errors, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";
import { revokeInvite } from "@/server/team";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "ADMIN");
  } catch {
    return Errors.forbidden(requestId);
  }
  try {
    return ok(await revokeInvite(s.tenantId, params.id, s.userId), { requestId });
  } catch {
    return Errors.notFound(requestId, "Invite");
  }
}
