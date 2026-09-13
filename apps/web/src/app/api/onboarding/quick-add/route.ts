import { prisma } from "@ai-commerce/database";
import { Errors, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";
import { upsertVariantWithStock } from "@/server/products";
import { audit } from "@/server/audit";
import { isSafeImageUrl } from "@/server/url-safe";
import { z } from "zod";

/** Step 1: Product basics + price + initial quantity */
const step1Schema = z.object({
  name: z.string().min(1).max(200),
  nameAr: z.string().max(200).optional(),
  description: z.string().max(5000).optional(),
  descriptionAr: z.string().max(5000).optional(),
  brand: z.string().max(120).optional(),
  basePrice: z.number().int().min(0).max(100000000),
  currency: z.string().default("EGP"),
  quantity: z.number().int().min(0).max(1000000).default(0),
});

/** Step 2: Variants (colors + sizes) */
const step2Schema = z.object({
  productId: z.string().min(1),
  colors: z.array(z.string().min(1).max(60)).min(1).max(50),
  sizes: z.array(z.string().min(1).max(60)).min(1).max(50),
  quantityPerVariant: z.number().int().min(0).max(1000000).default(0),
  skuPrefix: z.string().min(1).max(10).optional(),
});

/** Step 3: Photos (URLs) */
const step3Schema = z.object({
  productId: z.string().min(1),
  imageUrls: z.array(z.string().url()).max(10).optional(),
});

const wizardSchema = z.object({
  step: z.enum(["1", "2", "3"]),
  data: z.unknown(),
});

/**
 * Guided quick-add wizard (3 steps, each skippable):
 * 1. Basics + price + initial qty (creates product + default "One Size" variant)
 * 2. Variants (colors × sizes) with SKU collision checking
 * 3. Photo URLs (fetch server-side, MIME/size validated)
 * Progress persisted in onboarding checklist API.
 */
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
  const parsed = wizardSchema.safeParse(body);
  if (!parsed.success) return Errors.validation(requestId, parsed.error.flatten());

  const { step, data } = parsed.data;
  const tenantId = s.tenantId;

  if (step === "1") {
    const p = step1Schema.parse(data);
    const { productCountEnforced } = await import("@/server/billing");
    const gate = await productCountEnforced(tenantId);
    if (!gate.allowed) return Errors.validation(requestId, gate.message);

    const product = await prisma.product.create({
      data: {
        tenantId,
        name: p.name,
        nameAr: p.nameAr,
        description: p.description,
        descriptionAr: p.descriptionAr,
        brand: p.brand,
        basePrice: p.basePrice,
        currency: p.currency,
        active: true,
      },
    });

    let defaultVariant = null;
    if (p.quantity > 0) {
      const prefix = (p.name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "PRD").padEnd(4, "X");
      let sku = "";
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = `${prefix}-${Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z0-9]/g, "X")}`;
        const taken = await prisma.productVariant.findFirst({ where: { tenantId, sku: candidate }, select: { id: true } });
        if (!taken) {
          sku = candidate;
          break;
        }
      }
      if (!sku) return Errors.validation(requestId, "Could not allocate a SKU, please retry");

      const result = await upsertVariantWithStock(
        tenantId,
        { productId: product.id, sku, attributes: { Size: "One Size" }, quantity: p.quantity },
        `user:${s.userId}`
      );
      defaultVariant = { id: result.variant.id, sku, quantity: result.quantity };
    }

    await audit({
      tenantId,
      actor: `user:${s.userId}`,
      action: "product.created",
      resource: "product",
      resourceId: product.id,
      newValue: { name: product.name, step: 1 } as never,
    });

    return ok({ product, defaultVariant, step: 1, nextStep: 2 }, { requestId, status: 201 });
  }

  if (step === "2") {
    const p = step2Schema.parse(data);
    const product = await prisma.product.findFirst({ where: { id: p.productId, tenantId } });
    if (!product) return Errors.notFound(requestId, "Product");

    const prefix = ((p.skuPrefix ?? product.name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4)) || "PRD").padEnd(4, "X");
    const matrix: Array<{ color: string; size: string; sku: string; attributes: Record<string, string> }> = [];
    const seenSkus = new Set<string>();

    for (const color of p.colors) {
      for (const size of p.sizes) {
        const colorClean = color.toUpperCase().replace(/[^A-Z0-9]/g, "X").slice(0, 8);
        const sizeClean = size.toUpperCase().replace(/[^A-Z0-9]/g, "X").slice(0, 8);
        let candidate = `${prefix}-${colorClean}-${sizeClean}`;
        let attempts = 0;
        while (attempts < 20 && (seenSkus.has(candidate) || await prisma.productVariant.findFirst({ where: { tenantId, sku: candidate }, select: { id: true } }))) {
          const suffix = Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z0-9]/g, "X");
          candidate = `${prefix}-${colorClean}-${sizeClean}-${suffix}`;
          attempts++;
        }
        if (attempts >= 20) {
          return Errors.validation(requestId, `Could not allocate unique SKU for ${color}/${size}`);
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

    const created: Array<{ sku: string; variantId: string; quantity: number }> = [];
    for (const item of matrix) {
      const result = await upsertVariantWithStock(
        tenantId,
        {
          productId: p.productId,
          sku: item.sku,
          attributes: item.attributes,
          quantity: p.quantityPerVariant,
        },
        `user:${s.userId}`
      );
      created.push({ sku: item.sku, variantId: result.variant.id, quantity: result.quantity });
    }

    await audit({
      tenantId,
      actor: `user:${s.userId}`,
      action: "product.variants_bulk_created",
      resource: "product",
      resourceId: p.productId,
      newValue: { colors: p.colors, sizes: p.sizes, count: created.length } as never,
    });

    return ok({ productId: p.productId, created, step: 2, nextStep: 3 }, { requestId, status: 201 });
  }

  if (step === "3") {
    const p = step3Schema.parse(data);
    const product = await prisma.product.findFirst({ where: { id: p.productId, tenantId } });
    if (!product) return Errors.notFound(requestId, "Product");

    if (p.imageUrls && p.imageUrls.length > 0) {
      // Validate and fetch images server-side (same guards as upload)
      const validUrls: string[] = [];
      for (const url of p.imageUrls) {
        if (!isSafeImageUrl(url)) continue;
        try {
          const res = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(10000) });
          if (res.ok) {
            const contentType = res.headers.get("content-type") ?? "";
            const contentLength = Number(res.headers.get("content-length") ?? "0");
            if (contentType.startsWith("image/") && contentLength <= 10 * 1024 * 1024) {
              validUrls.push(url);
            }
          }
        } catch {
          // Skip invalid/unfetchable URLs
        }
      }

      // Create ProductImage records
      for (let i = 0; i < validUrls.length; i++) {
        await prisma.productImage.create({
          data: {
            tenantId,
            productId: p.productId,
            url: validUrls[i],
            position: i,
          },
        });
      }
    }

    await audit({
      tenantId,
      actor: `user:${s.userId}`,
      action: "product.images_attached",
      resource: "product",
      resourceId: p.productId,
      newValue: { count: p.imageUrls?.length ?? 0 } as never,
    });

    return ok({ productId: p.productId, step: 3, complete: true }, { requestId });
  }

  return Errors.validation(requestId, "Invalid step");
}

/** Resume wizard state for a product */
export async function GET(req: Request) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);

  const url = new URL(req.url);
  const productId = url.searchParams.get("productId");
  if (!productId) return Errors.validation(requestId, "productId required");

  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId: s.tenantId },
    include: { variants: { include: { inventory: true } }, images: { orderBy: { position: "asc" } } },
  });
  if (!product) return Errors.notFound(requestId, "Product");

  const hasVariants = product.variants.length > 0;
  const hasImages = product.images.length > 0;

  return ok({
    product,
    step: hasVariants ? (hasImages ? 3 : 2) : 1,
    hasVariants,
    hasImages,
    variantsCount: product.variants.length,
    imagesCount: product.images.length,
  }, { requestId });
}