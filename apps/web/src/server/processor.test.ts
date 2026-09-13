import { describe, expect, it } from "vitest";
import { mediaFallbackReply } from "./processor";

describe("media fallback", () => {
  it("acknowledges voice notes without tools or LLM", () => {
    const r = mediaFallbackReply("audio");
    expect(r).toMatch(/فويس/);
  });

  it("acknowledges photos without claiming sight", () => {
    const r = mediaFallbackReply("image");
    expect(r).toMatch(/مش بعرف اشوف/);
    expect(r).not.toMatch(/متوفر|موجود/);
  });

  it("has a safe generic fallback", () => {
    expect(mediaFallbackReply(undefined)).toMatch(/ابعت|اكتب/);
    expect(mediaFallbackReply("sticker")).toBeTruthy();
  });
});
