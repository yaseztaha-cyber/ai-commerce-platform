/**
 * MessagingProvider abstraction — AI/order engine never talks to
 * WhatsApp/Instagram/etc. directly. All providers normalize to/from
 * the unified { to, text } shape.
 */

export interface OutboundMessage {
  to: string; // channel-specific recipient id (phone / thread id)
  text: string;
  replyTo?: string;
  /** Optional product photo. Sent as a native image message where supported. */
  image?: { url: string; caption?: string };
}

export interface SendResult {
  providerMessageId: string;
  success: boolean;
  error?: string;
}

export interface MessagingProvider {
  readonly channel: string;
  send(tenantId: string, msg: OutboundMessage): Promise<SendResult>;
}

/** Console logger provider (dev default). Real providers plug in here. */
export class ConsoleMessagingProvider implements MessagingProvider {
  readonly channel = "CONSOLE";
  async send(tenantId: string, msg: OutboundMessage): Promise<SendResult> {
    console.log(JSON.stringify({ ts: new Date().toISOString(), kind: "outbound_message", tenantId, to: msg.to, text: msg.text, image: msg.image?.url ?? null }));
    return { providerMessageId: `console_${Date.now()}`, success: true };
  }
}

export type InboundKind = "text" | "media";

export interface NormalizedInbound {
  provider: string;
  providerMessageId: string;
  channel: string;
  from: string;
  text: string;
  /** Non-text payloads (voice, photo, …) arrive as media: acknowledged, never parsed as intent. */
  kind: InboundKind;
  mediaType?: string;
  /** Provider media object id (for download/transcription). Absent for text. */
  mediaId?: string;
  mimeType?: string;
  timestamp?: string;
  raw?: unknown;
}
