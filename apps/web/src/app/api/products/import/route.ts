import { prisma } from "@ai-commerce/database";
import { Errors, isBodyTooLarge, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";
import { audit } from "@/server/audit";
import { NextResponse } from "next/server";

/** CSV import: name,nameAr,price,sku,color,size,qty[,chest,length,shoulder,sleeve] per row.
 * Measurement columns (cm) attach to that row's size for size advice.
 * Production-safe: BOM-tolerant, header/row validated, per-row errors
 * reported (never silent), `?dryRun=1` previews without writing. */
export async function POST(req: Request) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "MANAGER");
  } catch {
    return Errors.forbidden(requestId);
  }
  if (isBodyTooLarge(req, 2 * 1024 * 1024)) return Errors.tooLarge(requestId, 2048);
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const text = (await req.text()).replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const header = (lines.shift() ?? "").toLowerCase().split(",").map((h) => h.trim());
  const required = ["name", "price"];
  const missing = required.filter((h) => !header.includes(h));
  if (missing.length > 0) {
    return Errors.validation(requestId, `CSV header must include: ${missing.join(", ")} (got: ${header.join(",")})`);
  }
  const idx = (h: string) => header.indexOf(h);
  const errors: Array<{ row: number; message: string }> = [];
  let productsCreated = 0;
  let variantsUpserted = 0;
  const seenSkus = new Set<string>();
  const rows = lines.slice(0, 2000);
  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2; // 1-based incl. header
    const cols = rows[i].split(",").map((c) => c.trim());
    const get = (h: string) => (idx(h) >= 0 ? (cols[idx(h)] ?? "") : "");
    const name = get("name");
    const priceRaw = get("price");
    const sku = get("sku");
    const qtyRaw = get("qty") || "0";
    if (!name) {
      errors.push({ row: rowNo, message: "missing name" });
      continue;
    }
    const price = Number(priceRaw);
    if (!Number.isInteger(price) || price < 0 || price > 100000000) {
      errors.push({ row: rowNo, message: `invalid price '${priceRaw}'` });
      continue;
    }
    const qty = Number(qtyRaw);
    if (!Number.isInteger(qty) || qty < 0 || qty > 1000000) {
      errors.push({ row: rowNo, message: `invalid qty '${qtyRaw}'` });
      continue;
    }
    if (sku && seenSkus.has(sku)) {
      errors.push({ row: rowNo, message: `duplicate SKU '${sku}' within file` });
      continue;
    }
    if (sku) seenSkus.add(sku);
    // Optional measurement columns (cm) for this row's size.
    const measures: Record<string, number> = {};
    let measuresOk = true;
    for (const m of ["chest", "length", "shoulder", "sleeve"] as const) {
      const raw = get(m);
      if (raw === "") continue;
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0 || v > 300) {
        errors.push({ row: rowNo, message: `invalid ${m} '${raw}'` });
        measuresOk = false;
        break;
      }
      measures[m] = v;
    }
    if (!measuresOk) continue;
    const sizeName = get("size") || "M";
    if (dryRun) {
      productsCreated++;
      if (sku) variantsUpserted++;
      continue;
    }
    try {
      let product = await prisma.product.findFirst({ where: { tenantId: s.tenantId, name } });
      if (!product) {
        product = await prisma.product.create({
          data: { tenantId: s.tenantId, name, nameAr: get("nameAr") || undefined, basePrice: price },
        });
        productsCreated++;
      }
      if (sku) {
        const variant = await prisma.productVariant.upsert({
          where: { tenantId_sku: { tenantId: s.tenantId, sku } },
          update: { productId: product.id },
          create: {
            tenantId: s.tenantId,
            productId: product.id,
            sku,
            attributes: { Color: get("color") || "Black", Size: get("size") || "M" } as never,
          },
        });
        await prisma.inventory.upsert({
          where: { variantId: variant.id },
          update: {},
          create: { tenantId: s.tenantId, variantId: variant.id, quantity: qty },
        });
        variantsUpserted++;
      }
      if (Object.keys(measures).length > 0) {
        const { upsertMeasurement } = await import("@/server/sizing");
        await upsertMeasurement(s.tenantId, product.id, { size: sizeName, ...measures }, `user:${s.userId}`);
      }
    } catch (err) {
      errors.push({ row: rowNo, message: err instanceof Error ? err.message.slice(0, 160) : "row failed" });
    }
  }
  await audit({
    tenantId: s.tenantId,
    actor: `user:${s.userId}`,
    action: dryRun ? "product.import_previewed" : "product.imported",
    resource: "product",
    newValue: { productsCreated, variantsUpserted, errorCount: errors.length, dryRun } as never,
  });
  return ok({ dryRun, rows: rows.length, productsCreated, variantsUpserted, errors: errors.slice(0, 100) }, { requestId });
}

export async function GET() {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  const products = await prisma.product.findMany({
    where: { tenantId: s.tenantId },
    include: { variants: { include: { inventory: true } } },
  });
  const rows = ["name,nameAr,price,sku,color,size,qty"];
  for (const p of products) {
    if (p.variants.length === 0) rows.push([p.name, p.nameAr ?? "", String(p.basePrice), "", "", "", ""].join(","));
    for (const v of p.variants) {
      const a = (v.attributes ?? {}) as Record<string, string>;
      rows.push([p.name, p.nameAr ?? "", String(v.price ?? p.basePrice), v.sku, a.Color ?? "", a.Size ?? "", String(v.inventory?.quantity ?? 0)].join(","));
    }
  }
  return new NextResponse(rows.join("\n"), { headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=products.csv" } });
}
