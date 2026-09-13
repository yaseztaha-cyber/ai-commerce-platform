import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TranscriptionError,
  WhisperCompatibleProvider,
  downloadWhatsAppMedia,
  isTranscriptionConfigured,
} from "./transcribe";
import { shouldTranscribeRoute } from "../processor";

const origFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = origFetch;
  vi.unstubAllGlobals();
});

function resp(status: number, body: unknown) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

describe("transcription routing", () => {
  it("routes only WhatsApp audio with all deps present", () => {
    const full = { transcribeKey: "k", waToken: "w" };
    expect(shouldTranscribeRoute({ channel: "WHATSAPP", mediaType: "audio", mediaId: "m1" }, full)).toBe(true);
    expect(shouldTranscribeRoute({ channel: "WHATSAPP", mediaType: "image", mediaId: "m1" }, full)).toBe(false);
    expect(shouldTranscribeRoute({ channel: "SIMULATOR", mediaType: "audio", mediaId: "m1" }, full)).toBe(false);
    expect(shouldTranscribeRoute({ channel: "WHATSAPP", mediaType: "audio" }, full)).toBe(false);
    expect(shouldTranscribeRoute({ channel: "WHATSAPP", mediaType: "audio", mediaId: "m1" }, { transcribeKey: "", waToken: "w" })).toBe(false);
    expect(shouldTranscribeRoute({ channel: "WHATSAPP", mediaType: "audio", mediaId: "m1" }, { transcribeKey: "k", waToken: "" })).toBe(false);
  });

  it("is disabled without a key (fallback applies)", () => {
    expect(isTranscriptionConfigured()).toBe(false);
  });
});

describe("WhisperCompatibleProvider", () => {
  const keyed = { apiKey: "test-key", baseUrl: "https://stt.test/v1" };

  it("refuses without key and validates input locally", async () => {
    const p = new WhisperCompatibleProvider();
    await expect(p.transcribe(Buffer.from("x"), "audio/ogg")).rejects.toMatchObject({ kind: "disabled" });
    const k = new WhisperCompatibleProvider(keyed);
    await expect(k.transcribe(Buffer.from("x"), "application/x-sh")).rejects.toMatchObject({ kind: "failed" });
    await expect(k.transcribe(Buffer.alloc(0), "audio/ogg")).rejects.toMatchObject({ kind: "too_large" });
  });

  it("parses transcript text and trims", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(200, { text: "  عايز تيشيرت  " })));
    const r = await new WhisperCompatibleProvider(keyed).transcribe(Buffer.from([1, 2]), "audio/ogg");
    expect(r.text).toBe("عايز تيشيرت");
  });

  it("classifies auth/empty/timeout failures", async () => {
    const p = () => new WhisperCompatibleProvider(keyed);
    vi.stubGlobal("fetch", vi.fn(async () => resp(401, { error: "no" })));
    await expect(p().transcribe(Buffer.from([1]), "audio/ogg")).rejects.toMatchObject({ kind: "failed" });
    vi.stubGlobal("fetch", vi.fn(async () => resp(200, { text: "   " })));
    await expect(p().transcribe(Buffer.from([1]), "audio/ogg")).rejects.toMatchObject({ kind: "failed" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        throw e;
      })
    );
    await expect(p().transcribe(Buffer.from([1]), "audio/ogg")).rejects.toMatchObject({ kind: "timeout" });
  });
});

describe("downloadWhatsAppMedia", () => {
  it("requires credentials", async () => {
    await expect(downloadWhatsAppMedia("m1", { accessToken: "" })).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("downloads within caps, rejects oversize declarations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/m1")) return resp(200, { url: "https://cdn/file.ogg", mime_type: "audio/ogg" });
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-length": "3" } });
      })
    );
    const r = await downloadWhatsAppMedia("m1", { accessToken: "tok" });
    expect(r.bytes.length).toBe(3);
    expect(r.mime).toBe("audio/ogg");

    vi.stubGlobal("fetch", vi.fn(async () => resp(200, { url: "https://cdn/big.ogg", mime_type: "audio/ogg" })));
    // second fetch (bytes) also returns the meta shape -> arrayBuffer of JSON; force oversize via header
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("graph.facebook")) return resp(200, { url: "https://cdn/big.ogg", mime_type: "audio/ogg" });
        return new Response("x", { status: 200, headers: { "content-length": String(100 * 1024 * 1024) } });
      })
    );
    await expect(downloadWhatsAppMedia("m1", { accessToken: "tok" })).rejects.toMatchObject({ kind: "too_large" });
  });
});
