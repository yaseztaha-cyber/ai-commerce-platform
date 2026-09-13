import { prisma } from "@ai-commerce/database";
import { Errors, fail, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "AGENT");
  } catch {
    return Errors.forbidden(requestId);
  }
  const convo = await prisma.conversation.findFirst({ where: { id: params.id, tenantId: s.tenantId } });
  if (!convo) return Errors.notFound(requestId, "Conversation");
  const action = new URL(_req.url).pathname.endsWith("/resolve") ? "RESOLVED" : "HUMAN_ACTIVE";
  const updated = await prisma.conversation.update({ where: { id: convo.id }, data: { status: action, assignedTo: action === "HUMAN_ACTIVE" ? s.userId : undefined } });
  void fail;
  return ok({ conversation: updated }, { requestId });
}
