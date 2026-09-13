import crypto from "crypto";
import { config } from "@/lib/env";
import type { MessagingProvider, NormalizedInbound, OutboundMessage } from "./types";

/**
 * Instagram Messaging API adapter (Meta).
 * Docs: https://developers.facebook.com/docs/instagram-platform/instagram-messaging
 * - GET webhook: hub.mode=subscribe verification with VERIFY_TOKEN
 * - POST webhook: X-Hub-Signature-256 HMAC-SHA256 via APP_SECRET
 * - Send: POST /{VERSION}/{IG_USER_ID}/messages with Bearer token
 */
export class InstagramProvider implements MessagingProvider {
  readonly channel = "INSTAGRAM";
  private readonly verifyToken: string;
  private readonly appSecret: string;

  constructor(opts?: { verifyToken?: string; appSecret?: string }) {
    this.verifyToken = opts?.verifyToken ?? config.instagram.verifyToken;
    this.appSecret = opts?.appSecret ?? config.instagram.appSecret;
  }

  get configured(): boolean {
    return Boolean(config.instagram.accessToken && config.instagram.userId);
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
      entry?: Array<{ changes?: Array<{ value?: { messages?: Array<MetaMessage> } }> }>;
    };
    for (const entry of p?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const m of change.value?.messages ?? []) {
          if (!m.id || !m.from) continue;
          if (m.type === "text" && m.text?.body) {
            out.push({
              provider: "INSTAGRAM",
              providerMessageId: m.id,
              channel: "INSTAGRAM",
              from: m.from,
              text: m.text.body,
              kind: "text",
              timestamp: m.timestamp,
              raw: m,
            });
          } else if (m.type === "image" || m.type === "video" || m.type === "audio" || m.type === "file") {
            const mediaObjs: Record<string, { id?: string; mime_type?: string } | undefined> = {
              image: m.image,
              video: m.video,
              audio: m.audio,
              file: m.file,
            };
            const media = m.type ? mediaObjs[m.type] : undefined;
            out.push({
              provider: "INSTAGRAM",
              providerMessageId: m.id,
              channel: "INSTAGRAM",
              from: m.from,
              text: "",
              kind: "media",
              mediaType: m.type,
              mediaId: media?.id,
              mimeType: media?.mime_type,
              timestamp: m.timestamp,
              raw: m,
            });
          }
        }
      }
    }
    return out;
  }

  async send(_tenantId: string, msg: OutboundMessage) {
    if (!this.configured) {
      console.log(JSON.stringify({ kind: "instagram_unconfigured", to: msg.to, text: msg.text, image: msg.image?.url ?? null }));
      return { providerMessageId: `unconfigured_${Date.now()}`, success: true };
    }
    const url = `https://graph.facebook.com/${config.instagram.apiVersion}/${config.instagram.userId}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.instagram.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildInstagramPayload(msg)),
    });
    if (!res.ok) {
      const err = await res.text();
      return { providerMessageId: "", success: false, error: err.slice(0, 500) };
    }
    const data = (await res.json()) as { messages?: Array<{ id: string }> };
    return { providerMessageId: data.messages?.[0]?.id ?? `ig_${Date.now()}`, success: true };
  }
}

function toAbsoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${config.appUrl.replace(/\/$/, "")}${url.startsWith("/") ? url : `/${url}`}`;
}

/** Pure payload builder (unit-tested): text vs native image messages. */
export function buildInstagramPayload(msg: OutboundMessage): Record<string, unknown> {
  if (msg.image) {
    return {
      recipient: { id: msg.to },
      message: { attachment: { type: "image", payload: { url: toAbsoluteUrl(msg.image.url), is_reusable: true } } },
    };
  }
  return { recipient: { id: msg.to }, message: { text: msg.text } };
}

export const instagramProvider = new InstagramProvider();

interface MetaMessage {
  id: string;
  from: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string };
  video?: { id?: string; mime_type?: string };
  audio?: { id?: string; mime_type?: string };
  file?: { id?: string; mime_type?: string };
}