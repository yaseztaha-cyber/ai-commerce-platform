import { describe, expect, it } from "vitest";
import { calculateTotals, validateOrderBusinessRules, applyPromotions } from "./pricing";
import { canTransitionOrder } from "./constants";
import { createProductSchema } from "./schemas";
import {
  extractBodyMetrics,
  extractQuantity,
  extractRememberedSize,
  hasBodyMetrics,
  isCancellation,
  isConfirmation,
  isSizeAdvice,
  normalizeArabic,
  normalizeColorToken,
  normalizeSearchText,
  normalizeSizeToken,
  recallScore,
  searchTokens,
  scoreTokenRecall,
  signalTokens,
  stemArabicToken,
  toLatinDigits,
  tokenMatches,
  tokenOverlapScore,
  wantsHuman,
} from "./text";

describe("pricing", () => {
  it("computes subtotal + delivery + total", () => {
    const t = calculateTotals({
      lines: [{ unitPrice: 450, quantity: 1 }],
      deliveryFee: 60,
    });
    expect(t).toMatchObject({ subtotal: 450, deliveryFee: 60, total: 510 });
  });

  it("applies free delivery threshold", () => {
    const t = calculateTotals({
      lines: [{ unitPrice: 600, quantity: 1 }],
      deliveryFee: 60,
      freeDeliveryThreshold: 500,
    });
    expect(t.deliveryFee).toBe(0);
    expect(t.freeDeliveryApplied).toBe(true);
  });

  it("enforces minimum order + zone rules", () => {
    expect(
      validateOrderBusinessRules({ subtotal: 50, quantity: 1, minimumOrderAmount: 100, deliveryZoneAllowed: true })
    ).toMatchObject({ ok: false });
    expect(
      validateOrderBusinessRules({ subtotal: 500, quantity: 1, deliveryZoneAllowed: false })
    ).toMatchObject({ ok: false, code: "ZONE_NOT_SERVED" });
    expect(
      validateOrderBusinessRules({ subtotal: 500, quantity: 1, deliveryZoneAllowed: true })
    ).toMatchObject({ ok: true });
  });
});

describe("order state machine", () => {
  it("allows legal transitions and blocks illegal ones", () => {
    expect(canTransitionOrder("DRAFT", "PENDING_CONFIRMATION")).toBe(true);
    expect(canTransitionOrder("CONFIRMED", "COMPLETED")).toBe(false);
    expect(canTransitionOrder("CANCELLED", "CONFIRMED")).toBe(false);
    expect(canTransitionOrder("OUT_FOR_DELIVERY", "COMPLETED")).toBe(true);
  });
});

describe("arabic text utils", () => {
  it("normalizes alef/taa marbuta/diacritics", () => {
    expect(normalizeArabic("التيشيرت الأسود")).toBe(normalizeArabic("التيشيرت الاسود"));
    expect(normalizeArabic("تِيشِيرْت")).toBe("تيشيرت");
  });

  it("matches tshirt aliases", () => {
    const a = normalizeSearchText("oversized tshirt");
    const b = normalizeSearchText("تيشيرت اوفرسايز");
    expect(tokenOverlapScore(a, b)).toBeGreaterThan(0.3);
  });

  it("converges bilingual synonyms on one canonical form", () => {
    expect(normalizeSearchText("football t-shirt")).toBe("كوره تيشيرت");
    expect(normalizeSearchText("تيشيرت كورة")).toBe("تيشيرت كوره");
    expect(normalizeSearchText("classic white shirt")).toContain("قميص");
    expect(normalizeSearchText("قميص")).toContain("قميص");
    expect(normalizeSearchText("black sneakers")).toContain("كوتشي");
    expect(normalizeSearchText("عايز كوتشي")).toContain("كوتشي");
    expect(normalizeSearchText("levis jeans")).toBe("بنطلون جينز");
    expect(normalizeSearchText("بنطلون جينز")).toBe("بنطلون جينز");
    expect(normalizeSearchText("سويت شيرت اسود")).not.toContain("قميص");
  });

  it("scores bilingual recall for English-named products", () => {
    const signal = signalTokens("عايز قميص ابيض");
    expect(scoreTokenRecall(signal, new Set(searchTokens("Classic White Shirt")))).toBeGreaterThanOrEqual(0.34);
    const sneakers = signalTokens("عندك كوتشي؟");
    expect(scoreTokenRecall(sneakers, new Set(searchTokens("Air Sneakers")))).toBeGreaterThanOrEqual(0.34);
    expect(scoreTokenRecall(sneakers, new Set(searchTokens("Sleeveless Top")))).toBe(0);
  });

  it("normalizes sizes", () => {
    expect(normalizeSizeToken("عايز مقاس لارج")).toBe("L");
    expect(normalizeSizeToken("XL")).toBe("XL");
    expect(normalizeSizeToken("اكس لارج")).toBe("XL");
    expect(normalizeSizeToken("medium")).toBe("M");
  });

  it("normalizes colors", () => {
    expect(normalizeColorToken("عايز الاسود")).toBe("Black");
    expect(normalizeColorToken("white")).toBe("White");
    expect(normalizeColorToken("بيج")).toBe("Beige");
  });

  it("understands latin transliteration", () => {
    expect(normalizeColorToken("tshirt aswad")).toBe("Black");
    expect(normalizeColorToken("abyad")).toBe("White");
  });

  it("extracts quantities", () => {
    expect(extractQuantity("عايز اتنين")).toBe(2);
    expect(extractQuantity("x2")).toBe(2);
    expect(extractQuantity("عايز ٣")).toBe(3);
  });

  it("detects confirmation/cancel/human", () => {
    expect(isConfirmation("اكد")).toBe(true);
    expect(isConfirmation("تمام اكد الاوردر")).toBe(true);
    expect(isConfirmation("yes confirm")).toBe(true);
    expect(isCancellation("الغي الاوردر")).toBe(true);
    expect(wantsHuman("عايز اكلم حد من خدمة العملاء")).toBe(true);
  });
});

describe("retrieval tokens", () => {
  it("strips the ال article as an extra variant", () => {
    const toks = searchTokens("التيشيرت الأسود");
    expect(toks).toContain("تيشيرت");
    expect(toks).toContain("اسود");
  });

  it("drops stopwords from product signal", () => {
    const sig = signalTokens("عايز تيشيرت لو سمحت بكام");
    expect(sig).not.toContain("عايز");
    expect(sig).not.toContain("بكام");
    expect(sig).toContain("تيشيرت");
  });

  it("drops pronouns and availability words from product signal", () => {
    const sig = signalTokens("هو فيه تيشيرتات كورة متاحة");
    expect(sig).not.toContain("هو");
    expect(sig).not.toContain("فيه");
    expect(sig).not.toContain("متاحه");
    expect(sig).toContain("كوره");
  });

  it("stems Arabic plurals as extra variants, keeping the original", () => {
    expect(stemArabicToken("تيشيرتات")).toEqual(["تيشيرتات", "تيشيرت"]);
    expect(stemArabicToken("جينزات")).toEqual(["جينزات", "جينز"]);
    expect(stemArabicToken("مقاسات")).toEqual(["مقاسات", "مقاس"]);
    expect(stemArabicToken("تيشيرت")).toEqual(["تيشيرت"]);
    expect(stemArabicToken("بنات")).toEqual(["بنات"]);
    expect(searchTokens("التيشيرتات")).toContain("تيشيرت");
    expect(searchTokens("عندكم هوديز")).toContain("هوديز");
  });

  it("matches tokens tolerantly by shared prefix", () => {
    const hay = new Set(searchTokens("هودي"));
    expect(tokenMatches("هوديز", hay)).toBe(true);
    expect(tokenMatches("هودي", hay)).toBe(true);
    expect(tokenMatches("قميص", hay)).toBe(false);
    expect(tokenMatches("تي", new Set(["تيشيرت"]))).toBe(false);
  });

  it("matches single-character orthographic drift", () => {
    expect(tokenMatches("جاكت", new Set(searchTokens("جاكيت اسود")))).toBe(true);
    expect(tokenMatches("جاكيت", new Set(searchTokens("جاكت اسود")))).toBe(true);
    expect(tokenMatches("قميص", new Set(searchTokens("جيبات")))).toBe(false);
  });

  it("recalls the article-fused singular against a canonical catalog name", () => {
    const signal = signalTokens("عايز الجاكت");
    expect(scoreTokenRecall(signal, new Set(searchTokens("جاكت اسود")))).toBeGreaterThanOrEqual(0.34);
    expect(scoreTokenRecall(signal, new Set(searchTokens("جاكيت اسود")))).toBeGreaterThanOrEqual(0.34);
  });

  it("scores tolerant recall for the reported football-tee question", () => {
    const signal = signalTokens("هو فيه تيشيرتات كورة متاحة");
    expect(scoreTokenRecall(signal, new Set(searchTokens("تيشيرت كورة")))).toBeGreaterThanOrEqual(0.34);
    expect(scoreTokenRecall(signal, new Set(searchTokens("Football T-Shirt")))).toBeGreaterThanOrEqual(0.34);
    expect(scoreTokenRecall(signal, new Set(searchTokens("تيشيرت")))).toBeGreaterThanOrEqual(0.34);
    expect(scoreTokenRecall(signalTokens("عايز قميص"), new Set(searchTokens("تيشيرت كورة")))).toBe(0);
  });

  it("scores recall of query signal in haystack", () => {
    expect(recallScore(["تيشيرت", "اوفرسايز"], new Set(["تيشيرت", "اوفرسايز", "قطن"]))).toBe(1);
    expect(recallScore(["تيشيرت", "اوفرسايز"], new Set(["تيشيرت"]))).toBe(0.5);
    expect(recallScore([], new Set(["a"]))).toBe(0);
  });

  it("garbage normalizes to empty", () => {
    expect(normalizeSearchText("??")).toBe("");
  });
});

describe("product schemas", () => {
  const base = { name: "Cap", basePrice: 150 };
  it("accepts quick-add quantity", () => {
    const r = createProductSchema.safeParse({ ...base, quantity: 12 });
    expect(r.success).toBe(true);
  });
  it("quantity is optional and must be a non-negative integer", () => {
    expect(createProductSchema.safeParse(base).success).toBe(true);
    expect(createProductSchema.safeParse({ ...base, quantity: -1 }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...base, quantity: 1.5 }).success).toBe(false);
  });
});

describe("body metrics + size intent", () => {
  it("extracts height/weight/chest in Arabic, English, and Arabic-Indic digits", () => {
    expect(toLatinDigits("١٨٠")).toBe("180");
    expect(hasBodyMetrics("طولي 180")).toBe(true);
    expect(hasBodyMetrics("عايز تيشيرت")).toBe(false);
    expect(extractBodyMetrics("طولي 180 ووزني 85")).toMatchObject({ heightCm: 180, weightKg: 85, chestCm: null });
    expect(extractBodyMetrics("طولي ١٨٠")).toMatchObject({ heightCm: 180 });
    expect(extractBodyMetrics("my height is 175 and weight 70kg")).toMatchObject({ heightCm: 175, weightKg: 70 });
    expect(extractBodyMetrics("محيط الصدر 100")).toMatchObject({ chestCm: 100 });
    expect(extractBodyMetrics("chest 96")).toMatchObject({ chestCm: 96 });
  });

  it("rejects absurd body numbers", () => {
    expect(extractBodyMetrics("طولي 50")).toMatchObject({ heightCm: null });
    expect(extractBodyMetrics("وزني 500")).toMatchObject({ weightKg: null });
    expect(extractBodyMetrics("عايز 2 من الأسود")).toMatchObject({ heightCm: null, weightKg: null, chestCm: null });
  });

  it("detects fit preference", () => {
    expect(extractBodyMetrics("عايز حاجة واسعة").fit).toBe("oversized");
    expect(extractBodyMetrics("ضيق لو سمحت").fit).toBe("slim");
    expect(extractBodyMetrics("I want slim fit").fit).toBe("slim");
    expect(extractBodyMetrics("عايز تيشيرت").fit).toBeNull();
  });

  it("distinguishes advice from selection", () => {
    expect(isSizeAdvice("مقاسي ايه في التيشيرت ده؟")).toBe(true);
    expect(isSizeAdvice("اختار مقاس ايه؟ طولي 180")).toBe(true);
    expect(isSizeAdvice("what size should I get?")).toBe(true);
    expect(isSizeAdvice("طولي 180 ووزني 85")).toBe(true);
    expect(isSizeAdvice("عايز التيشيرت مقاس L")).toBe(false);
    expect(isSizeAdvice("عندكم مقاس XL؟")).toBe(false);
  });

  it("detects explicit size-memory opt-in", () => {
    expect(extractRememberedSize("مقاسي L دايما")).toBe("L");
    expect(extractRememberedSize("my size is always M")).toBe("M");
    expect(extractRememberedSize("عايز مقاس L")).toBeNull();
    expect(extractRememberedSize("مقاسي ايه؟")).toBeNull();
  });
});

describe("promotions engine", () => {
  const lines = [
    { unitPrice: 450, quantity: 2, productId: "p1" },
    { unitPrice: 350, quantity: 1, productId: "p2" },
  ]; // subtotal 1250
  const now = new Date("2026-09-07T12:00:00Z");

  it("applies percent with min-subtotal gating", () => {
    const r = applyPromotions(lines, [{ name: "Eid", kind: "PERCENT", value: 10 }], now);
    expect(r.discount).toBe(125);
    expect(r.applied[0]).toMatchObject({ name: "Eid", amount: 125 });
    const gated = applyPromotions(lines, [{ name: "Big", kind: "PERCENT", value: 10, minSubtotal: 2000 }], now);
    expect(gated.discount).toBe(0);
    expect(gated.applied).toEqual([]);
  });

  it("caps percent at 90 and clamps total discount to subtotal", () => {
    const r = applyPromotions(lines, [{ name: "X", kind: "PERCENT", value: 500 }], now);
    expect(r.discount).toBe(1125); // 90% of 1250
    const f = applyPromotions(lines, [{ name: "Y", kind: "FIXED", value: 99999 }], now);
    expect(f.discount).toBe(1250);
  });

  it("computes buy-2-get-1 per line", () => {
    const r = applyPromotions([{ unitPrice: 100, quantity: 5, productId: "p1" }], [{ name: "B2G1", kind: "BXGY", value: 0, buyQty: 2, getQty: 1 }], now);
    expect(r.discount).toBe(100); // floor(5/3)*1*100
    const scoped = applyPromotions(lines, [{ name: "S", kind: "BXGY", value: 0, buyQty: 2, getQty: 1, productIds: ["p2"] }], now);
    expect(scoped.discount).toBe(0); // p2 qty 1 -> no free unit
  });

  it("honors dates, active flag, usage caps, and scopes", () => {
    const base = { name: "T", kind: "FIXED" as const, value: 50 };
    expect(applyPromotions(lines, [{ ...base, active: false }], now).discount).toBe(0);
    expect(applyPromotions(lines, [{ ...base, startAt: new Date("2026-09-08") }], now).discount).toBe(0);
    expect(applyPromotions(lines, [{ ...base, endAt: new Date("2026-09-06") }], now).discount).toBe(0);
    expect(applyPromotions(lines, [{ ...base, usageLimit: 2, usedCount: 2 }], now).discount).toBe(0);
    expect(applyPromotions(lines, [{ ...base, productIds: ["nope"] }], now).discount).toBe(0);
    expect(applyPromotions(lines, [{ ...base, productIds: ["p1"] }], now).discount).toBe(50);
    expect(applyPromotions(lines, [{ name: "?", kind: "MYSTERY", value: 50 }], now).discount).toBe(0);
  });

  it("free shipping zeroes delivery through calculateTotals", () => {
    const t = calculateTotals({ lines, deliveryFee: 60, promotions: [{ name: "FS", kind: "FREE_SHIPPING", value: 0 }] });
    expect(t.deliveryFee).toBe(0);
    expect(t.promoFreeShipping).toBe(true);
    expect(t.total).toBe(1250);
    const t2 = calculateTotals({
      lines,
      deliveryFee: 60,
      promotions: [
        { name: "P", kind: "PERCENT", value: 10 },
        { name: "F", kind: "FIXED", value: 25 },
      ],
    });
    expect(t2.discount).toBe(150); // 125 + 25 stacked
    expect(t2.total).toBe(1100 + 60);
  });
});
