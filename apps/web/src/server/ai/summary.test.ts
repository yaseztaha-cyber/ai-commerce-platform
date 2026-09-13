import { describe, expect, it } from "vitest";
import { buildConversationSummary, needsSummary } from "./summary";

describe("conversation summary", () => {
  it("is empty for no history and gated by length", () => {
    expect(buildConversationSummary([])).toBe("");
    expect(needsSummary(5)).toBe(false);
    expect(needsSummary(13)).toBe(true);
  });

  it("extracts counts, products, and tools deterministically", () => {
    const s = buildConversationSummary([
      { role: "customer", content: "عايز تيشيرت" },
      { role: "assistant", content: "ok", toolCalls: [{ name: "search_products", arguments: {} }] },
      { role: "assistant", content: "ok", toolCalls: [{ name: "get_product", arguments: { product_id: "abc123456789" } }] },
    ]);
    expect(s).toContain("1 customer / 2 assistant");
    expect(s).toContain("23456789");
    expect(s).toContain("search_products");
  });
});
