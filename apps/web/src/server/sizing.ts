import { prisma } from "@ai-commerce/database";

/**
 * Size intelligence (leak 6). Numbers live in the DB (this module), prose
 * guides stay in RAG. Recommendations are ADVISORY: the agent must present
 * them as suggestions and confirm — never assert fit as fact.
 */

export interface MeasurementRow {
  size: string;
  chest: number | null;
  length: number | null;
  shoulder: number | null;
  sleeve: number | null;
}

const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"];

export function sortSizes(sizes: string[]): string[] {
  return [...sizes].sort((a, b) => {
    const ia = SIZE_ORDER.indexOf(a.toUpperCase());
    const ib = SIZE_ORDER.indexOf(b.toUpperCase());
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    if (a === "One Size") return -1;
    if (b === "One Size") return 1;
    return a.localeCompare(b);
  });
}

export type FitPreference = "slim" | "regular" | "oversized";

const EASE_CM: Record<FitPreference, number> = { slim: 2, regular: 6, oversized: 10 };

export interface RecommendInput {
  chestCm?: number;
  heightCm?: number;
  weightKg?: number;
  fit?: FitPreference;
}

export interface SizeRecommendation {
  size: string;
  reason: string;
}

/**
 * Pure ranking over a measurement table. Prefers an explicit chest
 * measurement (high confidence); falls back to a coarse, explicitly
 * low-confidence height/weight estimate; otherwise returns the table for
 * the agent to ask. Never invents numbers — every reason cites table cm.
 */
export function rankSizes(
  rows: MeasurementRow[],
  input: RecommendInput
): { recommendations: SizeRecommendation[]; method: "chest" | "estimate" | "table"; confidence: "high" | "low" | "none" } {
  const ordered = sortSizes(rows.map((r) => r.size));
  const bySize = new Map(rows.map((r) => [r.size, r]));
  const tableLine = (s: string) => {
    const r = bySize.get(s);
    return r?.chest != null ? `${s} (chest ${r.chest}cm)` : s;
  };

  if (input.chestCm != null && Number.isFinite(input.chestCm) && input.chestCm > 0) {
    const fit = input.fit ?? "regular";
    const ease = EASE_CM[fit];
    const scored = ordered
      .map((s) => ({ s, chest: bySize.get(s)?.chest ?? null }))
      .filter((x): x is { s: string; chest: number } => x.chest != null)
      .map((x) => ({ ...x, gap: x.chest - (input.chestCm as number) - ease }));
    if (scored.length === 0) {
      return { recommendations: [], method: "table", confidence: "none" };
    }
    const fitting = scored.filter((x) => x.gap >= 0).sort((a, b) => a.gap - b.gap);
    const best = fitting[0] ?? [...scored].sort((a, b) => b.gap - a.gap)[0];
    const recs: SizeRecommendation[] = [
      { size: best.s, reason: `chest ${input.chestCm}cm + ${fit} ease → ${tableLine(best.s)}` },
    ];
    for (const alt of fitting.slice(1, 3)) {
      if (alt.s !== best.s) recs.push({ size: alt.s, reason: `also fits: ${tableLine(alt.s)}` });
    }
    return { recommendations: recs, method: "chest", confidence: "high" };
  }

  if (input.heightCm != null && input.weightKg != null && input.heightCm > 0 && input.weightKg > 0) {
    // Coarse estimate, explicitly labeled low-confidence: BMI bands mapped
    // onto the table's size order. The agent must present it as a suggestion.
    const bmi = input.weightKg / (input.heightCm / 100) ** 2;
    const idx = bmi < 19 ? 0 : bmi < 22 ? 1 : bmi < 25 ? 2 : bmi < 28 ? 3 : 4;
    const pick = ordered[Math.min(idx, ordered.length - 1)] ?? ordered[0];
    if (!pick) return { recommendations: [], method: "table", confidence: "none" };
    return {
      recommendations: [{ size: pick, reason: `rough estimate from height/weight — please confirm with a chest measurement (${tableLine(pick)})` }],
      method: "estimate",
      confidence: "low",
    };
  }

  return { recommendations: [], method: "table", confidence: "none" };
}

export async function getMeasurements(tenantId: string, productId: string): Promise<MeasurementRow[]> {
  const product = await prisma.product.findFirst({ where: { id: productId, tenantId } });
  if (!product) throw new Error("PRODUCT_NOT_FOUND");
  const rows = await prisma.productMeasurement.findMany({ where: { tenantId, productId } });
  return rows.map((r) => ({ size: r.size, chest: r.chest, length: r.length, shoulder: r.shoulder, sleeve: r.sleeve }));
}

export async function upsertMeasurement(
  tenantId: string,
  productId: string,
  input: { size: string; chest?: number | null; length?: number | null; shoulder?: number | null; sleeve?: number | null },
  actor = "system"
) {
  const product = await prisma.product.findFirst({ where: { id: productId, tenantId } });
  if (!product) throw new Error("PRODUCT_NOT_FOUND");
  const size = input.size.trim().slice(0, 20);
  if (!size) throw new Error("INVALID_SIZE");
  for (const v of [input.chest, input.length, input.shoulder, input.sleeve]) {
    if (v !== undefined && v !== null && (!Number.isFinite(v) || v < 0 || v > 300)) throw new Error("INVALID_MEASURE");
  }
  const row = await prisma.productMeasurement.upsert({
    where: { tenantId_productId_size: { tenantId, productId, size } },
    update: { chest: input.chest ?? undefined, length: input.length ?? undefined, shoulder: input.shoulder ?? undefined, sleeve: input.sleeve ?? undefined },
    create: { tenantId, productId, size, chest: input.chest ?? undefined, length: input.length ?? undefined, shoulder: input.shoulder ?? undefined, sleeve: input.sleeve ?? undefined },
  });
  void actor;
  return row;
}

export async function deleteMeasurement(tenantId: string, productId: string, size: string) {
  const row = await prisma.productMeasurement.findFirst({ where: { tenantId, productId, size } });
  if (!row) throw new Error("MEASUREMENT_NOT_FOUND");
  await prisma.productMeasurement.delete({ where: { id: row.id } });
  return { deleted: true };
}
