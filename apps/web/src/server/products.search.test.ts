import { describe, expect, it, vi } from "vitest";

const FIXTURES = [
  { id: "p1", name: "تيشيرت كورة", nameAr: null, basePrice: 350, aliases: [] as string[] },
  { id: "p2", name: "Football T-Shirt", nameAr: null, basePrice: 400, aliases: [] as string[] },
  { id: "p3", name: "بنطلون جينز", nameAr: null, basePrice: 600, aliases: [] as string[] },
];

vi.mock("@ai-commerce/database", () => ({
  prisma: {
    product: { findMany: async () => FIXTURES },
    productVariant: { findFirst: async () => null },
  },
}));

import { searchProducts } from "./products";

describe("searchProducts understanding (mocked catalog, no DB)", () => {
  it("finds football tees from the reported dialect question", async () => {
    const hits = await searchProducts("t1", "هو فيه تيشيرتات كورة متاحة");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].score).toBeGreaterThanOrEqual(0.34);
    expect(["p1", "p2"]).toContain(hits[0].id);
  });

  it("matches plural and prefix forms", async () => {
    const jeans = await searchProducts("t1", "فيه جينزات؟");
    expect(jeans.map((h) => h.id)).toContain("p3");
  });

  it("returns nothing for unrelated products and garbage", async () => {
    expect(await searchProducts("t1", "عايز قميص")).toEqual([]);
    expect(await searchProducts("t1", "??")).toEqual([]);
    expect(await searchProducts("t1", "")).toEqual([]);
  });
});
