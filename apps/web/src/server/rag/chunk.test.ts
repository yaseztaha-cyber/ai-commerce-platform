import { describe, expect, it } from "vitest";
import { chunkText } from "./chunk";

describe("chunkText", () => {
  it("splits long docs with overlap and counts tokens", () => {
    const doc = Array.from({ length: 20 }, (_, i) => `Paragraph ${i} about return policy and exchange rules.`).join("\n\n");
    const chunks = chunkText(doc, 600, 80);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].tokenCount).toBeGreaterThan(0);
    expect(chunks.every((c) => c.content.length > 0)).toBe(true);
  });

  it("returns empty for blank input", () => {
    expect(chunkText("   ")).toEqual([]);
  });
});
