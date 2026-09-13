import { prisma } from "@ai-commerce/database";
import { logger, newRequestId } from "@/lib/logger";
import { findOrCreateCustomer } from "./customers";
import { appendMessage, getOrCreateConversation } from "./conversations";
import { enqueue } from "./queue";
import { meter } from "./billing";
import type { NormalizedInbound } from "./messaging/types";

/**
 * WebhookReceiver -> SignatureVerification -> Idempotency ->
 * EventNormalization -> Queue -> ConversationProcessor
 *
 * The HTTP handler stays fast: it persists the WebhookEvent (unique on
 * tenant+providerMessageId for idempotency) and enqueues `process_message`.
 * Duplicate deliveries -> status DUPLICATE, no double processing.
 */
export async function ingestInbound(input: {
  tenantId: string;
  inbound: NormalizedInbound;
}) {
  const requestId = newRequestId();
  const { tenantId, inbound } = input;

  try {
    await prisma.webhookEvent.create({
      data: {
        tenantId,
        provider: inbound.provider,
        providerMessageId: inbound.providerMessageId,
        eventType: "message",
        payload: inbound.raw as never,
        status: "RECEIVED",
      },
    });
  } catch {
    // Unique violation => duplicate webhook delivery
    await prisma.webhookEvent.updateMany({
      where: { tenantId, providerMessageId: inbound.providerMessageId },
      data: { status: "DUPLICATE" },
    });
    logger.info("duplicate webhook ignored", { requestId, tenantId, messageId: inbound.providerMessageId });
    return { duplicate: true, requestId };
  }

  const customer = await findOrCreateCustomer(tenantId, inbound.from);
  void meter(tenantId, "message"); // backend-derived usage, never blocks ingest
  const convo = await getOrCreateConversation({
    tenantId,
    channel: inbound.channel,
    externalId: `${inbound.channel}:${inbound.from}`,
    customerId: customer.id,
  });

  // Media payloads get a readable marker so the inbox shows what arrived.
  const content = inbound.kind === "media" ? mediaMarker(inbound.mediaType) : inbound.text;

  // If a human has taken over, store the message but do NOT auto-respond.
  if (convo.status === "HUMAN_ACTIVE") {
    await appendMessage({
      tenantId,
      conversationId: convo.id,
      role: "customer",
      content,
      providerMessageId: `${inbound.provider}:${inbound.providerMessageId}`,
    });
    await prisma.webhookEvent.updateMany({
      where: { tenantId, providerMessageId: inbound.providerMessageId },
      data: { status: "PROCESSED" },
    });
    return { duplicate: false, requestId, conversationId: convo.id, humanHandled: true };
  }

  const { message, duplicate } = await appendMessage({
    tenantId,
    conversationId: convo.id,
    role: "customer",
    content,
    providerMessageId: `${inbound.provider}:${inbound.providerMessageId}`,
  });
  if (duplicate) {
    await prisma.webhookEvent.updateMany({
      where: { tenantId, providerMessageId: inbound.providerMessageId },
      data: { status: "DUPLICATE" },
    });
    return { duplicate: true, requestId };
  }

  await enqueue("process_message", {
    tenantId,
    conversationId: convo.id,
    messageId: message.id,
    providerMessageId: inbound.providerMessageId,
    customerId: customer.id,
    channel: inbound.channel,
    from: inbound.from,
    text: inbound.text,
    kind: inbound.kind ?? "text",
    mediaType: inbound.mediaType,
    mediaId: inbound.mediaId,
    requestId,
  });

  return { duplicate: false, requestId, conversationId: convo.id, messageId: message.id };
}

function mediaMarker(mediaType?: string): string {
  if (mediaType === "audio") return "🎤 voice message";
  if (mediaType === "image") return "🖼️ photo";
  if (mediaType === "video") return "🎬 video";
  if (mediaType === "document") return "📎 file";
  return "📦 media message";
}
