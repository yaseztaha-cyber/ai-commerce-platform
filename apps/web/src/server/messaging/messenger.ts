import crypto from "crypto";
import { config } from "@/lib/env";
import type { MessagingProvider, NormalizedInbound, OutboundMessage } from "./types";

/**
 * Facebook Messenger Platform adapter (Meta).
 * Docs: https://developers.facebook.com/docs/messenger-platform
 * - GET webhook: hub.mode=subscribe verification with VERIFY_TOKEN
 * - POST webhook: X-Hub-Signature-256 HMAC-SHA256 via APP_SECRET
 * - Send: POST /{VERSION}/me/messages with Bearer token
 */
export class MessengerProvider implements MessagingProvider {
  readonly channel = "MESSENGER";
  private readonly verifyToken: string;
  private readonly appSecret: string;

  constructor(opts?: { verifyToken?: string; appSecret?: string }) {
    this.verifyToken = opts?.verifyToken ?? config.messenger.verifyToken;
    this.appSecret = opts?.appSecret ?? config.messenger.appSecret;
  }

  get configured(): boolean {
    return Boolean(config.messenger.accessToken && config.messenger.pageId);
  }

  verifySubscribe(mode: string | null, token: string | null, challenge: string | null): string | null {
    if (mode === "subscribe" && token && token === this.verifyToken && challenge) return challenge;
    return null;
  }

  verifySignature(rawBody: string, signatureHeader: string | null): boolean {
    if (!this.appSecret) return true; // not configured -> accept (dev), route still idempotent
    if (!signatureHeader?.startsWith("sha256=")) return false;
    const expected = crypto.createHmac("sha256", this.appSecret).update(rawBody).digest("hex");
    const given = signatureHeader.slice("sha256=".length);
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
    } catch {
      return false;
    }
  }

  /** Normalize Meta webhook payload -> unified inbound messages. */
  normalize(payload: unknown): NormalizedInbound[] {
    const out: NormalizedInbound[] = [];
    const p = payload as {
      entry?: Array<{ messaging?: Array<MetaMessage> }>;
    };
    for (const entry of p?.entry ?? []) {
      for (const m of entry.messaging ?? []) {
        if (!m.sender?.id || !m.recipient?.id) continue;
        if (m.message?.text) {
          out.push({
            provider: "MESSENGER",
            providerMessageId: m.message.mid ?? `msg_${Date.now()}`,
            channel: "MESSENGER",
            from: m.sender.id,
            text: m.message.text,
            kind: "text",
            timestamp: m.timestamp?.toString(),
            raw: m,
          });
        } else if (m.message?.attachments) {
          for (const att of m.message.attachments) {
            if (att.type === "image" || att.type === "video" || att.type === "audio" || att.type === "file") {
              out.push({
                provider: "MESSENGER",
                providerMessageId: m.message.mid ?? `msg_${Date.now()}`,
                channel: "MESSENGER",
                from: m.sender.id,
                text: "",
                kind: "media",
                mediaType: att.type,
                mediaId: att.payload?.url,
                mimeType: undefined,
                timestamp: m.timestamp?.toString(),
                raw: m,
              });
            }
          }
        }
      }
    }
    return out;
  }

  async send(_tenantId: string, msg: OutboundMessage) {
    if (!this.configured) {
      console.log(JSON.stringify({ kind: "messenger_unconfigured", to: msg.to, text: msg.text, image: msg.image?.url ?? null }));
      return { providerMessageId: `unconfigured_${Date.now()}`, success: true };
    }
    const url = `https://graph.facebook.com/${config.messenger.apiVersion}/me/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.messenger.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildMessengerPayload(msg)),
    });
    if (!res.ok) {
      const err = await res.text();
      return { providerMessageId: "", success: false, error: err.slice(0, 500) };
    }
    const data = (await res.json()) as { message_id?: string };
    return { providerMessageId: data.message_id ?? `msgr_${Date.now()}`, success: true };
  }
}

function toAbsoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${config.appUrl.replace(/\/$/, "")}${url.startsWith("/") ? url : `/${url}`}`;
}

/** Pure payload builder (unit-tested): text vs native image messages. */
export function buildMessengerPayload(msg: OutboundMessage): Record<string, unknown> {
  if (msg.image) {
    return {
      recipient: { id: msg.to },
      message: { attachment: { type: "image", payload: { url: toAbsoluteUrl(msg.image.url), is_reusable: true } } },
    };
  }
  return { recipient: { id: msg.to }, message: { text: msg.text } };
}

export const messengerProvider = new MessengerProvider();

interface MetaMessage {
  sender?: { id: string };
  recipient?: { id: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    attachments?: Array<{
      type: string;
      payload?: { url?: string };
    }>;
  };
}