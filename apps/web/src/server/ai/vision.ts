import { config } from "@/lib/env";

/**
 * Inbound sight (leak 2B): classify a customer product photo into a
 * catalog-shaped hint. Whisper-style contract — vendor/model env-driven
 * over OpenAI-compatible `/chat/completions` with image parts.
 *
 * Hard rule preserved end-to-end: vision output is an UNTRUSTED CANDIDATE.
 * It becomes plain text fed to the normal agent turn, so stock, prices,
 * and disambiguation still come from tools. Below-confidence or malformed
 * output degrades to the text fallback — never a guessed product.
 */

export type VisionErrorKind = "disabled" | "unavailable" | "too_large" | "timeout" | "failed" | "low_confidence";

export class VisionError extends Error {
  readonly kind: VisionErrorKind;
  constructor(kind: VisionErrorKind, message: string) {
    super(message);
    this.name = "VisionError";
    this.kind = kind;
  }
}

export interface VisionReading {
  productHint: string;
  colorHint: string;
  confidence: number;
}

export interface VisionProvider {
  readonly name: string;
  classify(image: Buffer, mime: string): Promise<VisionReading>;
}

const IMAGE_ALLOWLIST = new Set(["image/jpeg", "image/png", "image/webp"]);

const SYSTEM_PROMPT = [
  "You classify clothing product photos for a store sales assistant.",
  "Reply with ONLY a JSON object, no markdown, no extra text:",
  '{"product_hint": "<product type in English, e.g. Oversized T-Shirt>", "color_hint": "<main color in English or empty>", "confidence": <0-1>, "notes": "<short>"}',
  "If no clothing product is recognizable, set product_hint to empty and confidence below 0.5.",
].join("\n");

export class OpenAICompatibleVisionProvider implements VisionProvider {
  readonly name = "openai-compatible-vision";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly minConfidence: number;

  /** Overrides exist for unit tests; production always uses env config. */
  constructor(opts?: { apiKey?: string; baseUrl?: string; model?: string; timeoutMs?: number; maxBytes?: number; minConfidence?: number }) {
    this.apiKey = opts?.apiKey ?? config.vision.apiKey;
    this.baseUrl = (opts?.baseUrl ?? config.vision.baseUrl).replace(/\/$/, "");
    this.model = opts?.model ?? config.vision.model;
    this.timeoutMs = opts?.timeoutMs ?? config.vision.timeoutMs;
    this.maxBytes = opts?.maxBytes ?? config.vision.maxBytes;
    this.minConfidence = opts?.minConfidence ?? config.vision.minConfidence;
  }

  async classify(image: Buffer, mime: string): Promise<VisionReading> {
    if (!this.apiKey) throw new VisionError("disabled", "Vision not configured");
    const type = mime.split(";")[0].trim().toLowerCase();
    if (!IMAGE_ALLOWLIST.has(type)) throw new VisionError("failed", `Unsupported image type: ${type || "unknown"}`);
    if (image.length === 0 || image.length > this.maxBytes) {
      throw new VisionError("too_large", `Image size ${image.length} outside 1..${this.maxBytes}`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // detail:low keeps per-call cost predictable for chat photos.
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          max_tokens: 300,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: "Classify this clothing product photo." },
                { type: "image_url", image_url: { url: `data:${type};base64,${image.toString("base64")}`, detail: "low" } },
              ],
            },
          ],
        }),
      });
      if (res.status === 401 || res.status === 403) throw new VisionError("failed", `Vision auth rejected (${res.status})`);
      if (res.status === 429) throw new VisionError("failed", "Vision rate limited (429)");
      if (!res.ok) throw new VisionError("failed", `Vision failed (${res.status})`);
      const data = (await res.json().catch(() => null)) as {
        choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
      } | null;
      const raw = data?.choices?.[0]?.message?.content;
      const text = (typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((p) => p.text ?? "").join("") : "").trim();
      const reading = parseReading(text);
      if (!reading) throw new VisionError("failed", "Vision returned unparseable output");
      if (!reading.productHint || reading.confidence < this.minConfidence) {
        throw new VisionError("low_confidence", `Vision confidence ${reading.confidence} below ${this.minConfidence}`);
      }
      return reading;
    } catch (err) {
      if (err instanceof VisionError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new VisionError("timeout", `Vision timeout after ${this.timeoutMs}ms`);
      }
      throw new VisionError("failed", "Vision network error");
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Defensive JSON parse (strips code fences); null when unusable. */
export function parseReading(text: string): VisionReading | null {
  try {
    const clean = text.replace(/```json|```/g, "").trim();
    const v = JSON.parse(clean) as Record<string, unknown>;
    const confidence = typeof v.confidence === "number" ? v.confidence : NaN;
    if (!Number.isFinite(confidence)) return null;
    return {
      productHint: typeof v.product_hint === "string" ? v.product_hint.slice(0, 200) : "",
      colorHint: typeof v.color_hint === "string" ? v.color_hint.slice(0, 80) : "",
      confidence: Math.max(0, Math.min(1, confidence)),
    };
  } catch {
    return null;
  }
}

/** Vision reading rendered as labeled customer-visible text (auditability). */
export function readingToText(reading: VisionReading): string {
  const parts = [reading.productHint, reading.colorHint].map((s) => s.trim()).filter(Boolean);
  return `📷 وصف الصورة: ${parts.join("، ")}`;
}
