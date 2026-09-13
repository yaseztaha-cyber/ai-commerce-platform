import { Errors, fail, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";
import { createInvite, listTeam } from "@/server/team";
import type { Role } from "@ai-commerce/shared";
import { z } from "zod";

export async function GET() {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "ADMIN");
  } catch {
    return Errors.forbidden(requestId);
  }
  return ok(await listTeam(s.tenantId), { requestId });
}

const inviteSchema = z.object({
  email: z.string().email().max(200),
  role: z.enum(["OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER"]),
});

export async function POST(req: Request) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  let me;
  try {
    me = await requireRole(s.tenantId, "ADMIN");
  } catch {
    return Errors.forbidden(requestId);
  }
  const body = await req.json().catch(() => null);
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) return Errors.validation(requestId, parsed.error.flatten());
  try {
    const invite = await createInvite({
      tenantId: s.tenantId,
      inviterUserId: s.userId,
      inviterRole: me.role as Role,
      email: parsed.data.email,
      role: parsed.data.role as Role,
    });
    // Token shown once to the inviter to share (no mailer configured).
    return ok({ invite: { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt, token: invite.token } }, { requestId, status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invite failed";
    if (msg.startsWith("FORBIDDEN")) return Errors.forbidden(requestId);
    return fail("INVITE_FAILED", msg, { status: 400, requestId });
  }
}
