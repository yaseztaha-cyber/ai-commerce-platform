import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { buildWhatsAppPayload, WhatsAppProvider } from "./whatsapp";

describe("WhatsAppProvider", () => {
  it("verifies subscribe handshake only with matching token", () => {
    const provider = new WhatsAppProvider({ verifyToken: "secret123" });
    expect(provider.verifySubscribe("subscribe", "secret123", "CHALLENGE")).toBe("CHALLENGE");
    expect(provider.verifySubscribe("subscribe", "wrong", "CHALLENGE")).toBeNull();
    expect(provider.verifySubscribe("unsubscribe", "secret123", "CHALLENGE")).toBeNull();
    expect(provider.verifySubscribe("subscribe", "secret123", null)).toBeNull();
  });

  it("accepts unsigned webhooks only when no app secret is configured (dev)", () => {
    expect(new WhatsAppProvider({ appSecret: "" }).verifySignature("{}", null)).toBe(true);
  });

  it("validates HMAC-SHA256 signatures with timing-safe compare", () => {
    const provider = new WhatsAppProvider({ appSecret: "app-secret-xyz" });
    const raw = '{"entry":[{"id":"1"}]}';
    const good = "sha256=" + crypto.createHmac("sha256", "app-secret-xyz").update(raw).digest("hex");
    expect(provider.verifySignature(raw, good)).toBe(true);
    expect(provider.verifySignature(raw, "sha256=" + "0".repeat(64))).toBe(false);
    expect(provider.verifySignature(raw, null)).toBe(false);
    expect(provider.verifySignature(raw, "md5=abc")).toBe(false);
    expect(provider.verifySignature(raw + "tampered", good)).toBe(false);
  });

  it("normalizes Meta payload to unified inbound", () => {
    const provider = new WhatsAppProvider();
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { id: "wamid.1", from: "201000000000", timestamp: "123", type: "text", text: { body: "عايز التيشيرت الأسود" } },
                  { id: "wamid.2", from: "201000000000", timestamp: "124", type: "image" },
                ],
              },
            },
          ],
        },
      ],
    };
    const inbounds = provider.normalize(payload);
    expect(inbounds).toHaveLength(2);
    expect(inbounds[0]).toMatchObject({ providerMessageId: "wamid.1", from: "201000000000", text: "عايز التيشيرت الأسود", kind: "text" });
    expect(inbounds[1]).toMatchObject({ providerMessageId: "wamid.2", kind: "media", mediaType: "image", text: "" });
  });

  it("emits voice notes as media, never as text intent", () => {
    const provider = new WhatsAppProvider();
    const inbounds = provider.normalize({
      entry: [{ changes: [{ value: { messages: [{ id: "wamid.9", from: "201000000001", type: "audio" }] } }] }],
    });
    expect(inbounds).toHaveLength(1);
    expect(inbounds[0]).toMatchObject({ kind: "media", mediaType: "audio" });
  });

  it("builds native image payloads with absolute links", () => {
    const img = buildWhatsAppPayload({ to: "2010", text: "review", image: { url: "/api/files/t/abc.png" } });
    expect(img).toMatchObject({ type: "image" });
    expect((img.image as { link: string }).link).toMatch(/^https?:\/\/.+\/api\/files\/t\/abc\.png$/);
    const text = buildWhatsAppPayload({ to: "2010", text: "hi" });
    expect(text).toMatchObject({ type: "text", text: { body: "hi" } });
  });

  it("tolerates malformed payloads without throwing", () => {
    const provider = new WhatsAppProvider();
    expect(provider.normalize(null)).toEqual([]);
    expect(provider.normalize({})).toEqual([]);
    expect(provider.normalize({ entry: [{ changes: [{ value: {} }] }] })).toEqual([]);
  });
});
