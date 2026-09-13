import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OpenAICompatibleVisionProvider,
  VisionError,
  parseReading,
  readingToText,
} from "./vision";
import { shouldSightRoute } from "../processor";

const origFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = origFetch;
  vi.unstubAllGlobals();
});

function resp(status: number, body: unknown) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

describe("sight routing", () => {
  it("routes only WhatsApp photos with all deps present", () => {
    const full = { visionKey: "k", waToken: "w" };
    expect(shouldSightRoute({ channel: "WHATSAPP", mediaType: "image", mediaId: "m1" }, full)).toBe(true);
    expect(shouldSightRoute({ channel: "WHATSAPP", mediaType: "audio", mediaId: "m1" }, full)).toBe(false);
    expect(shouldSightRoute({ channel: "WHATSAPP", mediaType: "sticker", mediaId: "m1" }, full)).toBe(false);
    expect(shouldSightRoute({ channel: "SIMULATOR", mediaType: "image", mediaId: "m1" }, full)).toBe(false);
    expect(shouldSightRoute({ channel: "WHATSAPP", mediaType: "image" }, full)).toBe(false);
    expect(shouldSightRoute({ channel: "WHATSAPP", mediaType: "image", mediaId: "m1" }, { visionKey: "", waToken: "w" })).toBe(false);
  });
});

describe("parseReading", () => {
  it("parses strict and fenced JSON, rejects garbage", () => {
    expect(parseReading('{"product_hint":"Hoodie","color_hint":"Black","confidence":0.9}')).toMatchObject({
      productHint: "Hoodie",
      colorHint: "Black",
      confidence: 0.9,
    });
    expect(parseReading('```json\n{"product_hint":"Tee","confidence":0.4}\n```')).toMatchObject({ productHint: "Tee", confidence: 0.4 });
    expect(parseReading("not json")).toBeNull();
    expect(parseReading('{"product_hint":"x"}')).toBeNull();
  });

  it("renders labeled audit text", () => {
    expect(readingToText({ productHint: "Hoodie", colorHint: "Black", confidence: 0.9 })).toContain("📷 وصف الصورة:");
  });
});

describe("OpenAICompatibleVisionProvider", () => {
  const keyed = { apiKey: "test-key", baseUrl: "https://vis.test/v1" };

  it("refuses without key and validates input locally", async () => {
    const p = new OpenAICompatibleVisionProvider();
    await expect(p.classify(Buffer.from("x"), "image/png")).rejects.toMatchObject({ kind: "disabled" });
    const k = new OpenAICompatibleVisionProvider(keyed);
    await expect(k.classify(Buffer.from("x"), "application/x-sh")).rejects.toMatchObject({ kind: "failed" });
    await expect(k.classify(Buffer.alloc(0), "image/png")).rejects.toMatchObject({ kind: "too_large" });
  });

  it("sends low-detail image parts and parses readings", async () => {
    const seen: Array<{ url: string; body: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        seen.push({ url, body: init.body as string });
        return resp(200, { choices: [{ message: { content: '{"product_hint":"Hoodie","color_hint":"Black","confidence":0.85}' } }] });
      })
    );
    const r = await new OpenAICompatibleVisionProvider(keyed).classify(Buffer.from([1, 2]), "image/png");
    expect(r).toMatchObject({ productHint: "Hoodie", confidence: 0.85 });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://vis.test/v1/chat/completions");
    const body = JSON.parse(seen[0].body) as { messages: Array<{ content: unknown }> };
    expect(JSON.stringify(body.messages)).toContain("image_url");
    expect(JSON.stringify(body.messages)).toContain('"detail":"low"');
  });

  it("enforces the confidence gate and classifies failures", async () => {
    const p = () => new OpenAICompatibleVisionProvider({ ...keyed, minConfidence: 0.7 });
    vi.stubGlobal("fetch", vi.fn(async () => resp(200, { choices: [{ message: { content: '{"product_hint":"Tee","confidence":0.2}' } }] })));
    await expect(p().classify(Buffer.from([1]), "image/png")).rejects.toMatchObject({ kind: "low_confidence" });
    vi.stubGlobal("fetch", vi.fn(async () => resp(200, { choices: [{ message: { content: "hello world" } }] })));
    await expect(p().classify(Buffer.from([1]), "image/png")).rejects.toMatchObject({ kind: "failed" });
    vi.stubGlobal("fetch", vi.fn(async () => resp(500, {})));
    await expect(p().classify(Buffer.from([1]), "image/png")).rejects.toMatchObject({ kind: "failed" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        throw e;
      })
    );
    await expect(p().classify(Buffer.from([1]), "image/png")).rejects.toMatchObject({ kind: "timeout" });
    expect(VisionError).toBeTruthy();
  });
});
