import { prisma } from "@ai-commerce/database";
import { Errors, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";
import { appendMessage } from "@/server/conversations";
import { whatsappProvider } from "@/server/messaging/whatsapp";
import { z } from "zod";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  const convo = await prisma.conversation.findFirst({
    where: { id: params.id, tenantId: s.tenantId },
    include: { customer: true, messages: { orderBy: { createdAt: "asc" }, take: 200 } },
  });
  if (!convo) return Errors.notFound(requestId, "Conversation");
  return ok({ conversation: convo }, { requestId });
}

/** Delete a conversation and its messages (privacy). Orders are preserved. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "MANAGER");
  } catch {
    return Errors.forbidden(requestId);
  }
  const convo = await prisma.conversation.findFirst({ where: { id: params.id, tenantId: s.tenantId } });
  if (!convo) return Errors.notFound(requestId, "Conversation");
  await prisma.message.deleteMany({ where: { conversationId: convo.id } });
  await prisma.toolCall.deleteMany({ where: { conversationId: convo.id } });
  await prisma.aiRun.deleteMany({ where: { conversationId: convo.id } });
  await prisma.order.updateMany({ where: { conversationId: convo.id }, data: { conversationId: null } });
  await prisma.conversation.delete({ where: { id: convo.id } });
  return ok({ deleted: true }, { requestId });
}

/** Human agent reply (takeover path). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "AGENT");
  } catch {
    return Errors.forbidden(requestId);
  }
  const body = await req.json().catch(() => null);
  const parsed = z.object({ text: z.string().min(1).max(4000) }).safeParse(body);
  if (!parsed.success) return Errors.validation(requestId);
  const convo = await prisma.conversation.findFirst({ where: { id: params.id, tenantId: s.tenantId } });
  if (!convo) return Errors.notFound(requestId, "Conversation");
  await prisma.conversation.update({ where: { id: convo.id }, data: { status: "HUMAN_ACTIVE", assignedTo: s.userId } });
  await appendMessage({ tenantId: s.tenantId, conversationId: convo.id, role: "human_agent", content: parsed.data.text });
  // deliver over channel if possible
  const to = convo.externalId?.split(":").slice(1).join(":") ?? "";
  if (convo.channel === "WHATSAPP" && to) {
    await whatsappProvider.send(s.tenantId, { to, text: parsed.data.text }).catch(() => {});
  }
  return ok({ sent: true }, { requestId });
}

/**
 * Conversation status control (AGENT+): resume AI, hand to human queue,
 * or resolve. AI_ACTIVE <-> HUMAN_REQUIRED <-> HUMAN_ACTIVE -> RESOLVED.
 */
const STATUS_FLOW: Record<string, string[]> = {
  AI_ACTIVE: ["HUMAN_REQUIRED", "HUMAN_ACTIVE", "RESOLVED"],
  HUMAN_REQUIRED: ["AI_ACTIVE", "HUMAN_ACTIVE", "RESOLVED"],
  HUMAN_ACTIVE: ["AI_ACTIVE", "RESOLVED"],
  RESOLVED: ["AI_ACTIVE"],
};

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "AGENT");
  } catch {
    return Errors.forbidden(requestId);
  }
  const body = await req.json().catch(() => null);
  const parsed = z.object({ status: z.enum(["AI_ACTIVE", "HUMAN_REQUIRED", "HUMAN_ACTIVE", "RESOLVED"]) }).safeParse(body);
  if (!parsed.success) return Errors.validation(requestId, parsed.error.flatten());
  const convo = await prisma.conversation.findFirst({ where: { id: params.id, tenantId: s.tenantId } });
  if (!convo) return Errors.notFound(requestId, "Conversation");
  const allowed = STATUS_FLOW[convo.status] ?? [];
  if (!allowed.includes(parsed.data.status)) {
    return Errors.validation(requestId, `Cannot move ${convo.status} to ${parsed.data.status}`);
  }
  const updated = await prisma.conversation.update({
    where: { id: convo.id },
    data: { status: parsed.data.status, assignedTo: parsed.data.status === "HUMAN_ACTIVE" ? s.userId : null },
  });
  return ok({ conversation: updated }, { requestId });
}
