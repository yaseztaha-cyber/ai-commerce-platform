import { prisma } from "@ai-commerce/database";
import { Errors, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";
import { upsertVariantWithStock } from "@/server/products";
import { audit } from "@/server/audit";
import { z } from "zod";

const bulkGenerateSchema = z.object({
  productName: z.string().min(1).max(200),
  nameAr: z.string().max(200).optional(),
  basePrice: z.number().int().min(0).max(100000000),
  colors: z.array(z.string().min(1).max(60)).min(1).max(50),
  sizes: z.array(z.string().min(1).max(60)).min(1).max(50),
  quantityPerVariant: z.number().int().min(0).max(1000000).default(0),
  skuPrefix: z.string().min(1).max(10).optional(),
  dryRun: z.boolean().default(false),
});

/** Bulk variant generator: from one product + color list + size list -> preview grid -> one-click create. */
export async function POST(req: Request) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "MANAGER");
  } catch {
    return Errors.forbidden(requestId);
  }

  const body = await req.json().catch(() => null);
  const parsed = bulkGenerateSchema.safeParse(body);
  if (!parsed.success) return Errors.validation(requestId, parsed.error.flatten());

  const { productName, nameAr, basePrice, colors, sizes, quantityPerVariant, skuPrefix, dryRun } = parsed.data;
  const tenantId = s.tenantId;

  // Generate SKU prefix from product name if not provided
  const prefix = ((skuPrefix ?? productName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4)) || "PRD").padEnd(4, "X");

  // Build preview matrix
  const matrix: Array<{ color: string; size: string; sku: string; attributes: Record<string, string> }> = [];
  const seenSkus = new Set<string>();

  for (const color of colors) {
    for (const size of sizes) {
      const colorClean = color.toUpperCase().replace(/[^A-Z0-9]/g, "X").slice(0, 8);
      const sizeClean = size.toUpperCase().replace(/[^A-Z0-9]/g, "X").slice(0, 8);
      let candidate = `${prefix}-${colorClean}-${sizeClean}`;
      let attempts = 0;
      // Collision check: find available SKU
      while (attempts < 20 && (seenSkus.has(candidate) || await prisma.productVariant.findFirst({ where: { tenantId, sku: candidate }, select: { id: true } }))) {
        const suffix = Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z0-9]/g, "X");
        candidate = `${prefix}-${colorClean}-${sizeClean}-${suffix}`;
        attempts++;
      }
      if (attempts >= 20) {
        return Errors.validation(requestId, "Could not allocate unique SKU for " + color + "/" + size);
      }
      seenSkus.add(candidate);
      matrix.push({
        color,
        size,
        sku: candidate,
        attributes: { Color: color, Size: size },
      });
    }
  }

  if (dryRun) {
    return ok({ matrix, total: matrix.length }, { requestId });
  }

  // Create product
  const product = await prisma.product.create({
    data: {
      tenantId,
      name: productName,
      nameAr,
      basePrice,
      active: true,
    },
  });

  // Create all variants with stock
  const created: Array<{ sku: string; variantId: string; quantity: number }> = [];
  for (const item of matrix) {
    const result = await upsertVariantWithStock(
      tenantId,
      {
        productId: product.id,
        sku: item.sku,
        attributes: item.attributes,
        quantity: quantityPerVariant,
      },
      `user:${s.userId}`
    );
    created.push({ sku: item.sku, variantId: result.variant.id, quantity: result.quantity });
  }

  await audit({
    tenantId,
    actor: `user:${s.userId}`,
    action: "product.bulk_generated",
    resource: "product",
    resourceId: product.id,
    newValue: { productName, colors, sizes, count: created.length } as never,
  });

  return ok({ product, created, total: created.length }, { requestId, status: 201 });
}

/** Preview mode: GET ?productName=&colors=...&sizes=... */
export async function GET(req: Request) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);

  const url = new URL(req.url);
  const productName = url.searchParams.get("productName") ?? "";
  const basePrice = Number(url.searchParams.get("basePrice") ?? "0");
  const colors = (url.searchParams.get("colors") ?? "").split(",").filter(Boolean);
  const sizes = (url.searchParams.get("sizes") ?? "").split(",").filter(Boolean);
  const _quantityPerVariant = Number(url.searchParams.get("quantityPerVariant") ?? "0");
  const skuPrefix = url.searchParams.get("skuPrefix") ?? undefined;

  if (!productName || colors.length === 0 || sizes.length === 0) {
    return Errors.validation(requestId, "productName, colors, sizes required");
  }

  const prefix = ((skuPrefix ?? productName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4)) || "PRD").padEnd(4, "X");
  const matrix: Array<{ color: string; size: string; sku: string; attributes: Record<string, string> }> = [];
  const seenSkus = new Set<string>();

  for (const color of colors) {
    for (const size of sizes) {
      const colorClean = color.toUpperCase().replace(/[^A-Z0-9]/g, "X").slice(0, 8);
      const sizeClean = size.toUpperCase().replace(/[^A-Z0-9]/g, "X").slice(0, 8);
      let candidate = `${prefix}-${colorClean}-${sizeClean}`;
      let attempts = 0;
      while (attempts < 20 && (seenSkus.has(candidate) || await prisma.productVariant.findFirst({ where: { tenantId: s.tenantId, sku: candidate }, select: { id: true } }))) {
        const suffix = Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z0-9]/g, "X");
        candidate = `${prefix}-${colorClean}-${sizeClean}-${suffix}`;
        attempts++;
      }
      if (attempts >= 20) {
        return Errors.validation(requestId, "Could not allocate unique SKU for " + color + "/" + size);
      }
      seenSkus.add(candidate);
      matrix.push({
        color,
        size,
        sku: candidate,
        attributes: { Color: color, Size: size },
      });
    }
  }

  return ok({ matrix, total: matrix.length, estimatedPrice: basePrice }, { requestId });
}