import { describe, expect, it } from "vitest";
import { rankSizes, sortSizes, type MeasurementRow } from "./sizing";

const TABLE: MeasurementRow[] = [
  { size: "S", chest: 96, length: 68, shoulder: 44, sleeve: 20 },
  { size: "M", chest: 102, length: 70, shoulder: 46, sleeve: 21 },
  { size: "L", chest: 108, length: 72, shoulder: 48, sleeve: 22 },
  { size: "XL", chest: 114, length: 74, shoulder: 50, sleeve: 23 },
];

describe("size ranking", () => {
  it("sorts sizes in wearing order, unknown last", () => {
    expect(sortSizes(["XL", "S", "M", "One Size", "XXL"])).toEqual(["S", "M", "XL", "XXL", "One Size"]);
  });

  it("ranks by chest + fit ease with cited numbers", () => {
    const r = rankSizes(TABLE, { chestCm: 100, fit: "regular" });
    expect(r.method).toBe("chest");
    expect(r.confidence).toBe("high");
    expect(r.recommendations[0]).toMatchObject({ size: "L" });
    expect(r.recommendations[0].reason).toContain("108");
  });

  it("slim fit picks closer, oversized picks roomier", () => {
    expect(rankSizes(TABLE, { chestCm: 100, fit: "slim" }).recommendations[0].size).toBe("M");
    expect(rankSizes(TABLE, { chestCm: 100, fit: "oversized" }).recommendations[0].size).toBe("XL");
  });

  it("falls back to a labeled low-confidence estimate", () => {
    const r = rankSizes(TABLE, { heightCm: 180, weightKg: 85 });
    expect(r.method).toBe("estimate");
    expect(r.confidence).toBe("low");
    expect(r.recommendations).toHaveLength(1);
  });

  it("returns the table when nothing measurable is given", () => {
    const r = rankSizes(TABLE, {});
    expect(r).toMatchObject({ method: "table", confidence: "none", recommendations: [] });
    expect(rankSizes([], { chestCm: 100 }).recommendations).toEqual([]);
  });
});
