import { prisma } from "@ai-commerce/database";
import {
  normalizeSearchText,
  scoreTokenRecall,
  searchTokens,
  signalTokens,
  tokenMatches,
  normalizeColorToken,
} from "@ai-commerce/shared";

export interface ProductHit {
  id: string;
  name: string;
  nameAr: string | null;
  basePrice: number;
  aliases: string[];
  score: number;
  matchedOn: "sku" | "exact" | "alias" | "fuzzy";
}

/**
 * Fast product lookup: exact SKU > exact name > alias > fuzzy token overlap.
 * Never silently picks when confidence is low — returns scored candidates
 * and lets the agent ask for clarification.
 */
export async function searchProducts(tenantId: string, query: string, limit = 5): Promise<ProductHit[]> {
  const q = query.trim();
  if (!q) return [];
  // Empty/garbage normalized query (e.g. "??") must match nothing.
  if (!normalizeSearchText(q)) return [];
  // Product-signal tokens: drop stopwords, color mentions, size words and
  // digits so "تيشيرت اوفرسايز اسود L" scores on {تيشيرت, اوفرسايز}.
  const sizeWordTokens = new Set(
    ["سمول", "ميديم", "لارج", "اكس", "small", "medium", "large", "extra", "s", "m", "l", "xl", "xxl"].map((w) =>
      normalizeSearchText(w)
    )
  );
  const signal = signalTokens(q).filter((t) => {
    if (/^[a-z0-9]$/.test(t)) return false; // bare size letter / digit
    if (/^\d+$/.test(t) || t === "x" || t === "×") return false;
    if (sizeWordTokens.has(t)) return false;
    if (normalizeColorToken(t)) return false; // e.g. اسود / black
    return true;
  });
  if (signal.length === 0) return [];
  const products = await prisma.product.findMany({
    where: { tenantId, active: true },
    select: { id: true, name: true, nameAr: true, basePrice: true, aliases: true },
    take: 200,
  });

  const nq = normalizeSearchText(q);
  const hits: ProductHit[] = [];

  // SKU exact (via variants)
  const skuMatch = await prisma.productVariant.findFirst({
    where: { tenantId, sku: { equals: q, mode: "insensitive" } },
    include: { product: { select: { id: true, name: true, nameAr: true, basePrice: true, aliases: true } } },
  });
  if (skuMatch) {
    hits.push({ ...variantProduct(skuMatch.product), score: 1, matchedOn: "sku" });
  }

  for (const p of products) {
    if (hits.some((h) => h.id === p.id)) continue;
    const nameNorm = normalizeSearchText(p.name);
    const nameArNorm = p.nameAr ? normalizeSearchText(p.nameAr) : "";
    if (nq === nameNorm || (nameArNorm && nq === nameArNorm)) {
      hits.push({ id: p.id, name: p.name, nameAr: p.nameAr, basePrice: p.basePrice, aliases: p.aliases, score: 0.98, matchedOn: "exact" });
      continue;
    }
    if (p.aliases.some((a) => normalizeSearchText(a) === nq)) {
      hits.push({ id: p.id, name: p.name, nameAr: p.nameAr, basePrice: p.basePrice, aliases: p.aliases, score: 0.9, matchedOn: "alias" });
      continue;
    }
    // recall-based fuzzy: how much of the query's product signal is covered.
    // Matching is tolerant (plurals, prefixes: تيشيرتات↔تيشيرت) so phrasing
    // never blocks a product the store actually has.
    const hay = `${p.name} ${p.nameAr ?? ""} ${p.aliases.join(" ")}`;
    const hayTokens = new Set(searchTokens(hay));
    const nameHayTokens = new Set(searchTokens(`${p.name} ${p.nameAr ?? ""} ${p.aliases.join(" ")}`));
    const nameHits = signal.filter((t) => tokenMatches(t, nameHayTokens)).length;
    let score = scoreTokenRecall(signal, hayTokens);
    // A directly mentioned name/alias token always qualifies the product as
    // a candidate (agent clarifies on ties instead of saying "not found").
    if (nameHits > 0) score = Math.max(score, 0.4);
    // bonus when every name token is mentioned
    const nameTokens = searchTokens(`${p.name} ${p.nameAr ?? ""}`).filter((t) => t.length > 1);
    const signalSet = new Set(signal);
    if (nameTokens.length > 0 && nameTokens.every((t) => tokenMatches(t, signalSet))) score = Math.min(1, score + 0.15);
    if (score >= 0.34) {
      hits.push({ id: p.id, name: p.name, nameAr: p.nameAr, basePrice: p.basePrice, aliases: p.aliases, score, matchedOn: "fuzzy" });
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

function variantProduct(p: { id: string; name: string; nameAr: string | null; basePrice: number; aliases: string[] }) {
  return { id: p.id, name: p.name, nameAr: p.nameAr, basePrice: p.basePrice, aliases: p.aliases };
}

export async function getProductWithVariants(tenantId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId },
    include: {
      variants: { include: { inventory: true }, orderBy: { sku: "asc" } },
      images: { orderBy: { position: "asc" } },
      category: true,
    },
  });
  return product;
}

export function variantLabel(attrs: Record<string, string>): string {
  const color = attrs.Color ?? attrs.color ?? "";
  const size = attrs.Size ?? attrs.size ?? "";
  const rest = Object.entries(attrs)
    .filter(([k]) => !["Color", "color", "Size", "size"].includes(k))
    .map(([, v]) => v);
  return [color, size, ...rest].filter(Boolean).join(" / ");
}

export interface UpsertVariantInput {
  productId: string;
  sku: string;
  price?: number | null;
  attributes: Record<string, string>;
  active?: boolean;
  /** Desired stock. Applied as a traced RESTOCK/ADJUSTMENT movement, never silently. */
  quantity?: number;
}

/**
 * Create/update a variant and optionally set its stock. Quantity changes
 * always go through adjustStock so a movement record exists.
 */
export async function upsertVariantWithStock(tenantId: string, input: UpsertVariantInput, actor = "system") {
  const product = await prisma.product.findFirst({ where: { id: input.productId, tenantId } });
  if (!product) throw new Error("PRODUCT_NOT_FOUND");
  const variant = await prisma.productVariant.upsert({
    where: { tenantId_sku: { tenantId, sku: input.sku } },
    update: {
      price: input.price ?? undefined,
      attributes: input.attributes as never,
      active: input.active ?? true,
      productId: product.id,
    },
    create: {
      tenantId,
      productId: product.id,
      sku: input.sku,
      price: input.price ?? undefined,
      attributes: input.attributes as never,
      active: input.active ?? true,
    },
  });
  let stockAdjusted = false;
  if (input.quantity !== undefined) {
    const { adjustStock } = await import("./inventory");
    const current = await prisma.inventory.findUnique({ where: { variantId: variant.id } });
    const delta = input.quantity - (current?.quantity ?? 0);
    if (delta !== 0) {
      await adjustStock({
        tenantId,
        variantId: variant.id,
        delta,
        type: "RESTOCK",
        reason: current ? "variant stock set via dashboard/API" : "initial stock on variant creation",
        actor,
      });
      stockAdjusted = true;
    } else if (!current) {
      await prisma.inventory.create({ data: { tenantId, variantId: variant.id, quantity: 0 } });
    }
  } else {
    await prisma.inventory.upsert({ where: { variantId: variant.id }, update: {}, create: { tenantId, variantId: variant.id, quantity: 0 } });
  }
  const stock = await prisma.inventory.findUnique({ where: { variantId: variant.id } });
  return { variant, quantity: stock?.quantity ?? 0, stockAdjusted };
}

/** Edit variant price/attributes/active flag (SKU immutable). Deactivation hides it from the AI immediately. */
export async function updateVariant(
  tenantId: string,
  variantId: string,
  patch: { price?: number | null; attributes?: Record<string, string>; active?: boolean }
) {
  const existing = await prisma.productVariant.findFirst({ where: { id: variantId, tenantId } });
  if (!existing) throw new Error("VARIANT_NOT_FOUND");
  return prisma.productVariant.update({
    where: { id: variantId },
    data: {
      ...(patch.price !== undefined ? { price: patch.price } : {}),
      ...(patch.attributes ? { attributes: patch.attributes as never } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
    },
  });
}
