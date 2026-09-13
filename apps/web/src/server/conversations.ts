import { prisma } from "@ai-commerce/database";

export async function getOrCreateConversation(input: {
  tenantId: string;
  channel: string;
  externalId: string;
  customerId?: string;
}) {
  let convo = await prisma.conversation.findUnique({
    where: { tenantId_channel_externalId: { tenantId: input.tenantId, channel: input.channel, externalId: input.externalId } },
  });
  if (!convo) {
    convo = await prisma.conversation.create({
      data: {
        tenantId: input.tenantId,
        channel: input.channel,
        externalId: input.externalId,
        customerId: input.customerId,
        status: "AI_ACTIVE",
        orderState: "DISCOVERY",
      },
    });
  } else if (input.customerId && !convo.customerId) {
    convo = await prisma.conversation.update({ where: { id: convo.id }, data: { customerId: input.customerId } });
  }
  return convo;
}

export async function appendMessage(input: {
  tenantId: string;
  conversationId: string;
  role: string;
  content: string;
  providerMessageId?: string;
  model?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  toolCalls?: unknown;
  toolOutputs?: unknown;
  error?: string;
}) {
  // Idempotency: provider message IDs are unique per tenant
  if (input.providerMessageId) {
    const dup = await prisma.message.findUnique({
      where: { tenantId_providerMessageId: { tenantId: input.tenantId, providerMessageId: input.providerMessageId } },
    });
    if (dup) return { message: dup, duplicate: true };
  }
  const message = await prisma.message.create({
    data: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      providerMessageId: input.providerMessageId,
      model: input.model,
      latencyMs: input.latencyMs,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      toolCalls: (input.toolCalls ?? undefined) as never,
      toolOutputs: (input.toolOutputs ?? undefined) as never,
      error: input.error,
    },
  });
  await prisma.conversation.update({ where: { id: input.conversationId }, data: { lastMessageAt: new Date() } });
  return { message, duplicate: false };
}

export async function requestHuman(tenantId: string, conversationId: string, reason: string) {
  const convo = await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: "HUMAN_REQUIRED" },
  });
  // Operational handoff context (bounded excerpts, no full transcript dump).
  let context: Record<string, unknown> = { reason };
  try {
    const [customer, draft, recent, failures] = await Promise.all([
      convo.customerId ? prisma.customer.findFirst({ where: { id: convo.customerId, tenantId }, select: { name: true, phone: true, totalOrders: true } }) : null,
      convo.draftOrderId
        ? prisma.order.findFirst({ where: { id: convo.draftOrderId, tenantId }, include: { items: true } })
        : null,
      prisma.message.findMany({ where: { tenantId, conversationId }, orderBy: { createdAt: "desc" }, take: 5, select: { role: true, content: true } }),
      prisma.toolCall.findMany({ where: { tenantId, conversationId, success: false }, orderBy: { createdAt: "desc" }, take: 3, select: { name: true, error: true } }),
    ]);
    context = {
      reason,
      customer,
      orderState: convo.orderState,
      draft: draft ? { status: draft.status, total: draft.total, items: draft.items.map((i) => `${i.productName} ${i.variantLabel} ×${i.quantity}`) } : null,
      recentMessages: recent.reverse().map((m) => ({ role: m.role, content: m.content.slice(0, 200) })),
      toolFailures: failures,
    };
  } catch {
    /* context is best-effort; escalation must never fail */
  }
  await prisma.notification.create({
    data: { tenantId, kind: "HUMAN_REQUESTED", channel: "CONSOLE", target: conversationId, payload: context as never, status: "QUEUED" },
  });
  return convo;
}

/** Persist outbound delivery state (queued → sent/failed) on a stored message. */
export async function updateMessageDelivery(
  messageId: string,
  patch: { providerMessageId?: string; channelMessageId?: string; error?: string }
) {
  await prisma.message.update({ where: { id: messageId }, data: patch }).catch(() => {});
}

export async function recentMessages(tenantId: string, conversationId: string, limit = 20) {
  return prisma.message.findMany({
    where: { tenantId, conversationId },
    orderBy: { createdAt: "desc" },
    take: limit,
  }).then((rows) => rows.reverse());
}
