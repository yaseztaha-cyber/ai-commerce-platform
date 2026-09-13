import { prisma } from "@ai-commerce/database";
import { logger } from "@/lib/logger";
import { config } from "@/lib/env";
import { runAgentTurn } from "./ai/agent";
import { appendMessage, updateMessageDelivery } from "./conversations";
import { whatsappProvider } from "./messaging/whatsapp";
import { ConsoleMessagingProvider, type SendResult } from "./messaging/types";
import { downloadWhatsAppMedia, TranscriptionError, WhisperCompatibleProvider } from "./ai/transcribe";
import { OpenAICompatibleVisionProvider, readingToText, VisionError } from "./ai/vision";
import { claimWebhookEvent, enqueue, registerHandler, type Job } from "./queue";
import { meter } from "./billing";

const consoleProvider = new ConsoleMessagingProvider();

/**
 * Transcription routing decision (pure inputs → deterministic).
 * Voice notes on WhatsApp go to the transcribe job ONLY when every
 * dependency is present; otherwise the instant text fallback applies.
 */
export function shouldTranscribeRoute(
  msg: { channel: string; mediaType?: string; mediaId?: string },
  deps: { transcribeKey: string; waToken: string }
): boolean {
  return msg.channel === "WHATSAPP" && msg.mediaType === "audio" && Boolean(msg.mediaId) && Boolean(deps.transcribeKey) && Boolean(deps.waToken);
}

/**
 * Sight routing decision (pure inputs → deterministic). Same contract as
 * transcription: every dependency present or instant fallback. Stickers and
 * non-image media are never sighted.
 */
export function shouldSightRoute(
  msg: { channel: string; mediaType?: string; mediaId?: string },
  deps: { visionKey: string; waToken: string }
): boolean {
  return msg.channel === "WHATSAPP" && msg.mediaType === "image" && Boolean(msg.mediaId) && Boolean(deps.visionKey) && Boolean(deps.waToken);
}
export function mediaFallbackReply(mediaType?: string): string {
  if (mediaType === "audio") return "وصلني الفويس نوت 🎤 بس لسه مش بعرف اسمع — اكتبلي طلبك كتابة وهساعدك على طول.";
  if (mediaType === "image") return "وصلتني الصورة 🖼️ بس لسه مش بعرف اشوف الصور — اوصفلي المنتج كتابة (الاسم واللون والمقاس).";
  return "وصلني الملف 📎 بس بتعامل مع الرسايل الكتابية بس دلوقتي — اكتبلي طلبك وهساعدك على طول.";
}

async function sendReply(tenantId: string, channel: string, to: string, text: string, image?: { url: string; caption?: string }): Promise<SendResult> {
  // Outbound lifecycle: queued (persisted first) -> sending -> sent/failed.
  if (!text && !image) return { providerMessageId: "", success: true };
  if (channel === "WHATSAPP") {
    const res = await whatsappProvider.send(tenantId, { to, text, image });
    if (!res.success) {
      logger.error("whatsapp send failed", { tenantId, error: res.error });
      await consoleProvider.send(tenantId, { to, text, image });
    }
    return res;
  }
  return consoleProvider.send(tenantId, { to, text, image });
}

/**
 * Conversation processor (queue job `process_message`):
 * runs the agent turn, persists the assistant reply, sends it over the
 * right channel, and marks the webhook event processed.
 */
export async function processMessageJob(payload: Record<string, unknown>) {
  const { tenantId, conversationId, messageId, providerMessageId, customerId, channel, from, text, kind, mediaType, requestId } = payload as {
    tenantId: string;
    conversationId: string;
    messageId: string;
    providerMessageId?: string;
    customerId: string;
    channel: string;
    from: string;
    text: string;
    kind?: string;
    mediaType?: string;
    requestId?: string;
  };
  const started = Date.now();
  // Exactly-once across workers: only the claim winner processes.
  if (providerMessageId) {
    const claimed = await claimWebhookEvent(tenantId, providerMessageId);
    if (!claimed) {
      logger.info("message already claimed by another worker, skipping", { requestId, tenantId, conversationId });
      return;
    }
  }
  // Media payloads (voice/photo/…) never reach the LLM directly.
  // Voice notes with transcription configured are queued for transcription;
  // photos with vision configured are queued for sight; everything else gets
  // the instant, zero-cost acknowledgment with zero tool calls.
  if (kind === "media") {
    const payloadMediaId = (payload as { mediaId?: string }).mediaId;
    if (
      providerMessageId &&
      payloadMediaId &&
      shouldTranscribeRoute(
        { channel, mediaType, mediaId: payloadMediaId },
        { transcribeKey: config.transcribe.apiKey, waToken: config.whatsapp.accessToken }
      )
    ) {
      // Release this job's claim; the transcribe job claims on ITS start so
      // retries stay correct and crashes stay visible (never stuck).
      await prisma.webhookEvent.updateMany({
        where: { tenantId, providerMessageId, status: "PROCESSING" },
        data: { status: "RECEIVED" },
      }).catch(() => {});
      await enqueue("transcribe_message", {
        tenantId,
        conversationId,
        messageId,
        providerMessageId,
        customerId,
        channel,
        from,
        mediaId: payloadMediaId,
        mediaType,
        requestId,
      });
      logger.info("voice note queued for transcription", { requestId, tenantId, conversationId, messageId });
      return;
    }
    if (
      providerMessageId &&
      payloadMediaId &&
      shouldSightRoute(
        { channel, mediaType, mediaId: payloadMediaId },
        { visionKey: config.vision.apiKey, waToken: config.whatsapp.accessToken }
      )
    ) {
      // Same claim handoff as transcription: release, enqueue, return.
      await prisma.webhookEvent.updateMany({
        where: { tenantId, providerMessageId, status: "PROCESSING" },
        data: { status: "RECEIVED" },
      }).catch(() => {});
      await enqueue("sight_message", {
        tenantId,
        conversationId,
        messageId,
        providerMessageId,
        customerId,
        channel,
        from,
        mediaId: payloadMediaId,
        mediaType,
        requestId,
      });
      logger.info("photo queued for sight", { requestId, tenantId, conversationId, messageId });
      return;
    }
    const reply = mediaFallbackReply(mediaType);
    const { message } = await appendMessage({ tenantId, conversationId, role: "assistant", content: reply, latencyMs: Date.now() - started });
    const res = await sendReply(tenantId, channel, from, reply);
    await updateMessageDelivery(message.id, {
      providerMessageId: res.providerMessageId || undefined,
      error: res.success ? undefined : (res.error ?? "send failed").slice(0, 500),
    });
    if (providerMessageId) {
      await prisma.webhookEvent.updateMany({
        where: { tenantId, providerMessageId },
        data: { status: "PROCESSED" },
      }).catch(() => {});
    }
    logger.info("media message acknowledged", { requestId, tenantId, conversationId, messageId, mediaType });
    return;
  }
  try {
    const reply = await runAgentTurn({ tenantId, conversationId, customerId, userText: text, requestId });
    if (reply.text) {
      const { message } = await appendMessage({ tenantId, conversationId, role: "assistant", content: reply.text, latencyMs: Date.now() - started });
      const res = await sendReply(tenantId, channel, from, reply.text, reply.image);
      await updateMessageDelivery(message.id, {
        providerMessageId: res.providerMessageId || undefined,
        error: res.success ? undefined : (res.error ?? "send failed").slice(0, 500),
      });
    }
    if (providerMessageId) {
      await prisma.webhookEvent.updateMany({
        where: { tenantId, providerMessageId },
        data: { status: "PROCESSED" },
      }).catch(() => {});
    }
    logger.info("message processed", { requestId, tenantId, conversationId, messageId, latencyMs: Date.now() - started });
  } catch (err) {
    logger.error("message processing failed", { requestId, tenantId, conversationId, error: String(err) });
    // Release the claim so a retry can re-claim (bounded by maxAttempts).
    // Rows stuck in RECEIVED after all retries are operator-visible.
    if (providerMessageId) {
      await prisma.webhookEvent.updateMany({
        where: { tenantId, providerMessageId, status: "PROCESSING" },
        data: { status: "RECEIVED" },
      }).catch(() => {});
    }
    const fallback = "معلش، عندي مشكلة تقنية دلوقتي. هحوّلك لحد من الفريق يساعدك.";
    await appendMessage({ tenantId, conversationId, role: "assistant", content: fallback, error: String(err).slice(0, 500) }).catch(() => {});
    await sendReply(tenantId, channel, from, fallback).catch(() => {});
    await prisma.conversation.update({ where: { id: conversationId }, data: { status: "HUMAN_REQUIRED" } }).catch(() => {});
    throw err;
  }
}

/**
 * Transcribe job: download voice note -> transcript -> normal agent turn.
 * Failure contract (never silent, never infinite):
 * - transcription timeout -> rethrow (bounded retry; re-download accepted)
 * - other transcription failures -> 1A text fallback + PROCESSED, done
 * - agent-phase failure -> generic fallback + escalate + rethrow (retry)
 */
export async function handleTranscribeMessage(
  job: Job,
  deps?: {
    download?: (mediaId: string) => Promise<{ bytes: Buffer; mime: string }>;
    transcribe?: (audio: Buffer, mime: string) => Promise<{ text: string }>;
  }
): Promise<void> {
  const p = job.payload as {
    tenantId: string;
    conversationId: string;
    messageId: string;
    providerMessageId?: string;
    customerId: string;
    channel: string;
    from: string;
    mediaId: string;
    mediaType?: string;
    requestId?: string;
  };
  const started = Date.now();
  const { tenantId, conversationId, messageId, providerMessageId, customerId, channel, from, requestId } = p;
  if (providerMessageId) {
    const claimed = await claimWebhookEvent(tenantId, providerMessageId);
    if (!claimed) {
      logger.info("transcribe job already claimed, skipping", { requestId, tenantId, conversationId });
      return;
    }
  }
  const markProcessed = () =>
    providerMessageId
      ? prisma.webhookEvent.updateMany({ where: { tenantId, providerMessageId }, data: { status: "PROCESSED" } }).catch(() => {})
      : Promise.resolve();
  const releaseClaim = () =>
    providerMessageId
      ? prisma.webhookEvent.updateMany({ where: { tenantId, providerMessageId, status: "PROCESSING" }, data: { status: "RECEIVED" } }).catch(() => {})
      : Promise.resolve();

  let transcript: string | null = null;
  try {
    const download = deps?.download ?? downloadWhatsAppMedia;
    const transcribe = deps?.transcribe ?? ((audio: Buffer, mime: string) => new WhisperCompatibleProvider().transcribe(audio, mime));
    const { bytes, mime } = await download(p.mediaId);
    transcript = (await transcribe(bytes, mime)).text;
    void meter(tenantId, "transcription");
  } catch (err) {
    const kind = err instanceof TranscriptionError ? err.kind : "failed";
    logger.error("transcription failed", { requestId, tenantId, conversationId, errorKind: kind });
    if (kind === "timeout") {
      await releaseClaim();
      throw err; // bounded retry via runWithRetry
    }
    // Deterministic failure (auth/size/format/down): answer with the 1A fallback, done.
    const reply = mediaFallbackReply(p.mediaType);
    const { message } = await appendMessage({ tenantId, conversationId, role: "assistant", content: reply, latencyMs: Date.now() - started });
    const res = await sendReply(tenantId, channel, from, reply);
    await updateMessageDelivery(message.id, {
      providerMessageId: res.providerMessageId || undefined,
      error: res.success ? undefined : (res.error ?? "send failed").slice(0, 500),
    });
    await markProcessed();
    return;
  }

  try {
    const reply = await runAgentTurn({ tenantId, conversationId, customerId, userText: transcript, requestId });
    if (reply.text) {
      const { message } = await appendMessage({ tenantId, conversationId, role: "assistant", content: reply.text, latencyMs: Date.now() - started });
      const res = await sendReply(tenantId, channel, from, reply.text, reply.image);
      await updateMessageDelivery(message.id, {
        providerMessageId: res.providerMessageId || undefined,
        error: res.success ? undefined : (res.error ?? "send failed").slice(0, 500),
      });
    }
    await markProcessed();
    logger.info("voice note transcribed and answered", { requestId, tenantId, conversationId, messageId, latencyMs: Date.now() - started });
  } catch (err) {
    logger.error("transcribed turn failed", { requestId, tenantId, conversationId, error: String(err) });
    await releaseClaim();
    const fallback = "معلش، عندي مشكلة تقنية دلوقتي. هحوّلك لحد من الفريق يساعدك.";
    await appendMessage({ tenantId, conversationId, role: "assistant", content: fallback, error: String(err).slice(0, 500) }).catch(() => {});
    await sendReply(tenantId, channel, from, fallback).catch(() => {});
    await prisma.conversation.update({ where: { id: conversationId }, data: { status: "HUMAN_REQUIRED" } }).catch(() => {});
    throw err;
  }
}

/**
 * Sight job: download photo -> vision reading -> normal agent turn on the
 * reading text. The reading is stored as a labeled customer message so the
 * merchant sees exactly what the AI acted on; it is UNTRUSTED input like
 * any customer text (tools still own stock/prices/disambiguation).
 * Failure contract mirrors transcription: timeout -> bounded retry;
 * deterministic failures (incl. low confidence) -> 1A fallback + PROCESSED;
 * agent-phase failure -> generic fallback + escalate + bounded retry.
 */
export async function handleSightMessage(
  job: Job,
  deps?: {
    download?: (mediaId: string) => Promise<{ bytes: Buffer; mime: string }>;
    classify?: (image: Buffer, mime: string) => Promise<{ productHint: string; colorHint: string; confidence: number }>;
  }
): Promise<void> {
  const p = job.payload as {
    tenantId: string;
    conversationId: string;
    messageId: string;
    providerMessageId?: string;
    customerId: string;
    channel: string;
    from: string;
    mediaId: string;
    mediaType?: string;
    requestId?: string;
  };
  const started = Date.now();
  const { tenantId, conversationId, messageId, providerMessageId, customerId, channel, from, requestId } = p;
  if (providerMessageId) {
    const claimed = await claimWebhookEvent(tenantId, providerMessageId);
    if (!claimed) {
      logger.info("sight job already claimed, skipping", { requestId, tenantId, conversationId });
      return;
    }
  }
  const markProcessed = () =>
    providerMessageId
      ? prisma.webhookEvent.updateMany({ where: { tenantId, providerMessageId }, data: { status: "PROCESSED" } }).catch(() => {})
      : Promise.resolve();
  const releaseClaim = () =>
    providerMessageId
      ? prisma.webhookEvent.updateMany({ where: { tenantId, providerMessageId, status: "PROCESSING" }, data: { status: "RECEIVED" } }).catch(() => {})
      : Promise.resolve();
  const answerFallback = async () => {
    const reply = mediaFallbackReply("image");
    const { message } = await appendMessage({ tenantId, conversationId, role: "assistant", content: reply, latencyMs: Date.now() - started });
    const res = await sendReply(tenantId, channel, from, reply);
    await updateMessageDelivery(message.id, {
      providerMessageId: res.providerMessageId || undefined,
      error: res.success ? undefined : (res.error ?? "send failed").slice(0, 500),
    });
    await markProcessed();
  };

  // Per-conversation cap: bounded cost, no runaway on photo dumps.
  const priorReadings = await prisma.message.count({
    where: { tenantId, conversationId, role: "customer", content: { startsWith: "📷 وصف الصورة:" } },
  });
  if (priorReadings >= config.vision.maxPerConversation) {
    logger.warn("sight cap reached for conversation", { tenantId, conversationId });
    await answerFallback();
    return;
  }

  let query: string | null = null;
  try {
    const download = deps?.download ?? downloadWhatsAppMedia;
    const classify = deps?.classify ?? ((image: Buffer, mime: string) => new OpenAICompatibleVisionProvider().classify(image, mime));
    const { bytes, mime } = await download(p.mediaId);
    const reading = await classify(bytes, mime);
    void meter(tenantId, "vision");
    const labeled = readingToText(reading);
    await appendMessage({ tenantId, conversationId, role: "customer", content: labeled });
    query = `${reading.productHint} ${reading.colorHint}`.trim();
  } catch (err) {
    const kind = err instanceof VisionError ? err.kind : "failed";
    logger.error("sight failed", { requestId, tenantId, conversationId, errorKind: kind });
    if (kind === "timeout") {
      await releaseClaim();
      throw err; // bounded retry via runWithRetry
    }
    await answerFallback(); // low_confidence and deterministic failures
    return;
  }

  try {
    const reply = await runAgentTurn({ tenantId, conversationId, customerId, userText: query, requestId });
    if (reply.text) {
      const { message } = await appendMessage({ tenantId, conversationId, role: "assistant", content: reply.text, latencyMs: Date.now() - started });
      const res = await sendReply(tenantId, channel, from, reply.text, reply.image);
      await updateMessageDelivery(message.id, {
        providerMessageId: res.providerMessageId || undefined,
        error: res.success ? undefined : (res.error ?? "send failed").slice(0, 500),
      });
    }
    await markProcessed();
    logger.info("photo sighted and answered", { requestId, tenantId, conversationId, messageId, latencyMs: Date.now() - started });
  } catch (err) {
    logger.error("sighted turn failed", { requestId, tenantId, conversationId, error: String(err) });
    await releaseClaim();
    const fallback = "معلش، عندي مشكلة تقنية دلوقتي. هحوّلك لحد من الفريق يساعدك.";
    await appendMessage({ tenantId, conversationId, role: "assistant", content: fallback, error: String(err).slice(0, 500) }).catch(() => {});
    await sendReply(tenantId, channel, from, fallback).catch(() => {});
    await prisma.conversation.update({ where: { id: conversationId }, data: { status: "HUMAN_REQUIRED" } }).catch(() => {});
    throw err;
  }
}

export function registerQueueHandlers() {
  registerHandler("process_message", async (job) => processMessageJob(job.payload));
  registerHandler("transcribe_message", async (job) => handleTranscribeMessage(job));
  registerHandler("sight_message", async (job) => handleSightMessage(job));
  registerHandler("send_notification", async () => {});
  registerHandler("update_analytics", async () => {});
  registerHandler("generate_embedding", async () => {});
  registerHandler("process_document", async () => {});
  registerHandler("send_message", async (job) => {
    const p = job.payload as { tenantId: string; channel: string; to: string; text: string };
    await sendReply(p.tenantId, p.channel, p.to, p.text);
  });
}
