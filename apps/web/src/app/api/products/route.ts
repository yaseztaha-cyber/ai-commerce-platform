import { prisma } from "@ai-commerce/database";
import { Errors, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";
import { createProductSchema } from "@ai-commerce/shared";
import { audit } from "@/server/audit";

export async function GET(req: Request) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const products = await prisma.product.findMany({
    where: { tenantId: s.tenantId, ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) },
    include: { variants: { include: { inventory: true } }, images: { orderBy: { position: "asc" } }, category: true },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return ok({ products }, { requestId });
}

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
  const parsed = createProductSchema.safeParse(body);
  if (!parsed.success) return Errors.validation(requestId, parsed.error.flatten());
  const { productCountEnforced } = await import("@/server/billing");
  const gate = await productCountEnforced(s.tenantId);
  if (!gate.allowed) return Errors.validation(requestId, gate.message);
  const p = parsed.data;
  const product = await prisma.product.create({
    data: {
      tenantId: s.tenantId,
      categoryId: p.categoryId ?? undefined,
      name: p.name,
      nameAr: p.nameAr,
      description: p.description,
      descriptionAr: p.descriptionAr,
      brand: p.brand,
      basePrice: p.basePrice,
      currency: p.currency,
      aliases: p.aliases,
      active: p.active,
    },
  });
  await audit({ tenantId: s.tenantId, actor: `user:${s.userId}`, action: "product.created", resource: "product", resourceId: product.id, newValue: { name: product.name } });
  // Quick-add quantity: auto-create a default "One Size" variant with stock,
  // so a product added with quantity is sellable immediately.
  let defaultVariant: { id: string; sku: string; quantity: number } | null = null;
  if (p.quantity !== undefined) {
    const { upsertVariantWithStock } = await import("@/server/products");
    const prefix = (p.name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "PRD").padEnd(4, "X");
    // Random suffix + existence check: never hijack another variant's SKU.
    let sku = "";
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = `${prefix}-${Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z0-9]/g, "X")}`;
      const taken = await prisma.productVariant.findFirst({ where: { tenantId: s.tenantId, sku: candidate }, select: { id: true } });
      if (!taken) {
        sku = candidate;
        break;
      }
    }
    if (!sku) return Errors.validation(requestId, "Could not allocate a SKU, please retry");
    const r = await upsertVariantWithStock(
      s.tenantId,
      { productId: product.id, sku, attributes: { Size: "One Size" }, quantity: p.quantity },
      `user:${s.userId}`
    );
    defaultVariant = { id: r.variant.id, sku, quantity: r.quantity };
  }
  return ok({ product, defaultVariant }, { requestId, status: 201 });
}
