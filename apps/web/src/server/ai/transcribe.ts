import { config } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Voice-note transcription (leak 1B). Whisper-compatible
 * (`POST {base}/audio/transcriptions`, multipart) behind a tiny interface so
 * the vendor/model stays env-configured, never hard-coded.
 *
 * Safety contract: failures ALWAYS degrade to the instant text fallback
 * (1A) — never a crash, never a hallucinated transcript, never an
 * unbounded download.
 */

export type TranscriptionErrorKind = "disabled" | "unavailable" | "too_large" | "timeout" | "failed";

export class TranscriptionError extends Error {
  readonly kind: TranscriptionErrorKind;
  constructor(kind: TranscriptionErrorKind, message: string) {
    super(message);
    this.name = "TranscriptionError";
    this.kind = kind;
  }
}

export interface TranscriptionProvider {
  readonly name: string;
  transcribe(audio: Buffer, mime: string): Promise<{ text: string }>;
}

const AUDIO_ALLOWLIST = new Set([
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/amr",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
]);

export function isTranscriptionConfigured(): boolean {
  return Boolean(config.transcribe.apiKey);
}

export class WhisperCompatibleProvider implements TranscriptionProvider {
  readonly name = "whisper-compatible";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly language: string;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  /** Overrides exist for unit tests; production always uses env config. */
  constructor(opts?: { apiKey?: string; baseUrl?: string; model?: string; language?: string; timeoutMs?: number; maxBytes?: number }) {
    this.apiKey = opts?.apiKey ?? config.transcribe.apiKey;
    this.baseUrl = (opts?.baseUrl ?? config.transcribe.baseUrl).replace(/\/$/, "");
    this.model = opts?.model ?? config.transcribe.model;
    this.language = opts?.language ?? config.transcribe.language;
    this.timeoutMs = opts?.timeoutMs ?? config.transcribe.timeoutMs;
    this.maxBytes = opts?.maxBytes ?? config.transcribe.maxBytes;
  }

  async transcribe(audio: Buffer, mime: string): Promise<{ text: string }> {
    if (!this.apiKey) throw new TranscriptionError("disabled", "Transcription not configured");
    const type = mime.split(";")[0].trim().toLowerCase();
    if (!AUDIO_ALLOWLIST.has(type)) throw new TranscriptionError("failed", `Unsupported audio type: ${type || "unknown"}`);
    if (audio.length === 0 || audio.length > this.maxBytes) {
      throw new TranscriptionError("too_large", `Audio size ${audio.length} outside 1..${this.maxBytes}`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(audio)], { type }), "voice.ogg");
      form.append("model", this.model);
      if (this.language) form.append("language", this.language);
      form.append("response_format", "json");
      const res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
      });
      if (res.status === 401 || res.status === 403) throw new TranscriptionError("failed", `Transcription auth rejected (${res.status})`);
      if (res.status === 429) throw new TranscriptionError("failed", "Transcription rate limited (429)");
      if (!res.ok) throw new TranscriptionError("failed", `Transcription failed (${res.status})`);
      const data = (await res.json().catch(() => null)) as { text?: unknown } | null;
      const text = typeof data?.text === "string" ? data.text.trim() : "";
      if (!text) throw new TranscriptionError("failed", "Transcription returned empty text");
      return { text: text.slice(0, 2000) };
    } catch (err) {
      if (err instanceof TranscriptionError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new TranscriptionError("timeout", `Transcription timeout after ${this.timeoutMs}ms`);
      }
      throw new TranscriptionError("failed", "Transcription network error");
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Download a WhatsApp media object (two-step Graph API). Caps bytes BEFORE
 * buffering fully; any failure surfaces as TranscriptionError for the
 * caller to degrade to the text fallback.
 */
export async function downloadWhatsAppMedia(
  mediaId: string,
  opts?: { accessToken?: string; apiVersion?: string }
): Promise<{ bytes: Buffer; mime: string }> {
  const accessToken = opts?.accessToken ?? config.whatsapp.accessToken;
  const apiVersion = opts?.apiVersion ?? config.whatsapp.apiVersion;
  if (!accessToken) throw new TranscriptionError("unavailable", "WhatsApp credentials missing");
  const api = `https://graph.facebook.com/${apiVersion}`;
  const auth = { Authorization: `Bearer ${accessToken}` };
  const metaRes = await fetch(`${api}/${mediaId}`, { headers: auth });
  if (!metaRes.ok) throw new TranscriptionError("unavailable", `Media lookup failed (${metaRes.status})`);
  const meta = (await metaRes.json().catch(() => null)) as { url?: unknown; mime_type?: unknown } | null;
  const url = typeof meta?.url === "string" ? meta.url : "";
  const mime = typeof meta?.mime_type === "string" ? meta.mime_type : "audio/ogg";
  if (!url) throw new TranscriptionError("unavailable", "Media URL missing");
  const fileRes = await fetch(url, { headers: auth });
  if (!fileRes.ok) throw new TranscriptionError("unavailable", `Media download failed (${fileRes.status})`);
  const declared = Number(fileRes.headers.get("content-length") ?? "0");
  if (declared > config.transcribe.maxBytes) throw new TranscriptionError("too_large", "Media exceeds transcription cap");
  const buf = Buffer.from(await fileRes.arrayBuffer());
  if (buf.length === 0 || buf.length > config.transcribe.maxBytes) {
    throw new TranscriptionError("too_large", "Media exceeds transcription cap");
  }
  logger.info("whatsapp media downloaded", { bytes: buf.length });
  return { bytes: buf, mime };
}
