import { prisma } from "@ai-commerce/database";
import { Errors, isBodyTooLarge, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";
import { audit } from "@/server/audit";
import { isSafeImageUrl } from "@/server/url-safe";
import { z } from "zod";

/** CSV v2: Column mapping preview, per-row error fixes inline, photo URL column.
 * No partial silent writes — all-or-nothing transaction per dryRun=false. */
const csvV2Schema = z.object({
  text: z.string().max(2 * 1024 * 1024), // 2MB max
  columnMap: z.record(z.string()).optional(), // header -> field mapping
  dryRun: z.boolean().default(false),
});

const VALID_FIELDS = [
  "name",
  "nameAr",
  "description",
  "descriptionAr",
  "brand",
  "basePrice",
  "currency",
  "sku",
  "color",
  "size",
  "qty",
  "chest",
  "length",
  "shoulder",
  "sleeve",
  "imageUrl",
] as const;

type ValidField = (typeof VALID_FIELDS)[number];

const REQUIRED_FIELDS: ValidField[] = ["name", "basePrice"];

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

  const body = await req.json().catch(() => null);
  const parsed = csvV2Schema.safeParse(body);
  if (!parsed.success) return Errors.validation(requestId, parsed.error.flatten());

  const { text, columnMap, dryRun } = parsed.data;
  const tenantId = s.tenantId;

  // Parse CSV (BOM-tolerant)
  const raw = text.replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return Errors.validation(requestId, "CSV must have header + at least 1 data row");

  const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
  const rows = lines.slice(1, 2001); // max 2000 rows

  // Build effective header mapping
  const effectiveHeader = header.map((h) => columnMap?.[h] ?? h);
  const idx = (field: string) => effectiveHeader.indexOf(field);
  const missing = REQUIRED_FIELDS.filter((f) => idx(f) < 0);
  if (missing.length > 0) {
    return Errors.validation(requestId, `CSV must include mapped columns for: ${missing.join(", ")} (effective headers: ${effectiveHeader.join(",")})`);
  }

  const get = (cols: string[], field: string) => {
    const i = idx(field);
    return i >= 0 ? (cols[i] ?? "") : "";
  };

  const errors: Array<{ row: number; field?: string; message: string; raw?: string }> = [];
  const preview: Array<{
    row: number;
    product: { name: string; nameAr?: string; description?: string; descriptionAr?: string; brand?: string; basePrice: number; currency?: string };
    variant?: { sku: string; color?: string; size?: string; qty: number; measures?: Record<string, number>; imageUrl?: string };
  }> = [];

  const seenSkus = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2; // 1-based incl. header
    const cols = rows[i].split(",").map((c) => c.trim());

    const name = get(cols, "name");
    const basePriceRaw = get(cols, "basePrice");
    const sku = get(cols, "sku");
    const qtyRaw = get(cols, "qty") || "0";

    // Validate required
    if (!name) {
      errors.push({ row: rowNo, field: "name", message: "missing name", raw: rows[i] });
      continue;
    }
    const basePrice = Number(basePriceRaw);
    if (!Number.isInteger(basePrice) || basePrice < 0 || basePrice > 100000000) {
      errors.push({ row: rowNo, field: "basePrice", message: `invalid basePrice '${basePriceRaw}'`, raw: rows[i] });
      continue;
    }

    // Optional fields
    const nameAr = get(cols, "nameAr") || undefined;
    const description = get(cols, "description") || undefined;
    const descriptionAr = get(cols, "descriptionAr") || undefined;
    const brand = get(cols, "brand") || undefined;
    const currency = get(cols, "currency") || "EGP";

    const qty = Number(qtyRaw);
    if (!Number.isInteger(qty) || qty < 0 || qty > 1000000) {
      errors.push({ row: rowNo, field: "qty", message: `invalid qty '${qtyRaw}'`, raw: rows[i] });
      continue;
    }

    // SKU handling
    const finalSku = sku;
    if (sku) {
      if (seenSkus.has(sku)) {
        errors.push({ row: rowNo, field: "sku", message: `duplicate SKU '${sku}' within file`, raw: rows[i] });
        continue;
      }
      // Check DB for existing SKU
      const existing = await prisma.productVariant.findFirst({ where: { tenantId, sku }, select: { id: true } });
      if (existing) {
        errors.push({ row: rowNo, field: "sku", message: `SKU '${sku}' already exists`, raw: rows[i] });
        continue;
      }
      seenSkus.add(sku);
    }

    // Measurements (cm)
    const measures: Record<string, number> = {};
    let measuresOk = true;
    for (const m of ["chest", "length", "shoulder", "sleeve"] as const) {
      const rawVal = get(cols, m);
      if (rawVal === "") continue;
      const v = Number(rawVal);
      if (!Number.isFinite(v) || v < 0 || v > 300) {
        errors.push({ row: rowNo, field: m, message: `invalid ${m} '${rawVal}'`, raw: rows[i] });
        measuresOk = false;
        break;
      }
      measures[m] = v;
    }
    if (!measuresOk) continue;

    // Image URL
    const imageUrl = get(cols, "imageUrl") || undefined;
    if (imageUrl) {
      if (!isSafeImageUrl(imageUrl)) {
        errors.push({ row: rowNo, field: "imageUrl", message: `invalid image URL (https only, served from a public host)`, raw: rows[i] });
        continue;
      }
      try {
        const res = await fetch(imageUrl, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(5000) });
        if (!res.ok || !res.headers.get("content-type")?.startsWith("image/") || Number(res.headers.get("content-length") ?? "0") > 10 * 1024 * 1024) {
          errors.push({ row: rowNo, field: "imageUrl", message: `invalid image URL (not an image or >10MB)`, raw: rows[i] });
          continue;
        }
      } catch {
        errors.push({ row: rowNo, field: "imageUrl", message: `could not fetch image URL`, raw: rows[i] });
        continue;
      }
    }

    const color = get(cols, "color") || "Black";
    const size = get(cols, "size") || "M";

    preview.push({
      row: rowNo,
      product: { name, nameAr, description, descriptionAr, brand, basePrice, currency },
      variant: { sku: finalSku, color, size, qty, measures: Object.keys(measures).length > 0 ? measures : undefined, imageUrl },
    });
  }

  if (dryRun) {
    return ok({ preview, totalRows: rows.length, validRows: preview.length, errors: errors.slice(0, 100) }, { requestId });
  }

  // All-or-nothing: collect products to create, then create in transaction
  const productGroups = new Map<string, typeof preview>(); // name -> rows
  for (const p of preview) {
    if (!productGroups.has(p.product.name)) productGroups.set(p.product.name, []);
    productGroups.get(p.product.name)!.push(p);
  }

  let productsCreated = 0;
  let variantsCreated = 0;
  let measurementsCreated = 0;
  let imagesCreated = 0;

  await prisma.$transaction(async (tx) => {
    for (const [productName, groupRows] of productGroups) {
      const firstRow = groupRows[0];
      const product = await tx.product.create({
        data: {
          tenantId,
          name: productName,
          nameAr: firstRow.product.nameAr,
          description: firstRow.product.description,
          descriptionAr: firstRow.product.descriptionAr,
          brand: firstRow.product.brand,
          basePrice: firstRow.product.basePrice,
          currency: firstRow.product.currency,
          active: true,
        },
      });
      productsCreated++;

      // Create default "One Size" variant if no explicit SKU in any row
      const hasExplicitSku = groupRows.some((r) => r.variant?.sku);
      const defaultQty = firstRow.variant?.qty ?? 0;
      if (!hasExplicitSku && defaultQty > 0) {
        const prefix = (productName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "PRD").padEnd(4, "X");
        let sku = "";
        for (let attempt = 0; attempt < 10; attempt++) {
          const candidate = `${prefix}-${Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z0-9]/g, "X")}`;
          const taken = await tx.productVariant.findFirst({ where: { tenantId, sku: candidate }, select: { id: true } });
          if (!taken) {
            sku = candidate;
            break;
          }
        }
        if (sku) {
          const variant = await tx.productVariant.create({
            data: { tenantId, productId: product.id, sku, attributes: { Size: "One Size" } as never },
          });
          await tx.inventory.create({ data: { tenantId, variantId: variant.id, quantity: defaultQty } });
          variantsCreated++;
        }
      }

      // Create explicit variants from rows
      for (const row of groupRows) {
        if (row.variant?.sku) {
          const variant = await tx.productVariant.create({
            data: {
              tenantId,
              productId: product.id,
              sku: row.variant.sku,
              attributes: { Color: row.variant.color, Size: row.variant.size } as never,
            },
          });
          await tx.inventory.create({ data: { tenantId, variantId: variant.id, quantity: row.variant.qty } });
          variantsCreated++;

          // Measurements
          if (row.variant?.measures) {
            await tx.productMeasurement.create({
              data: {
                tenantId,
                productId: product.id,
                size: row.variant.size ?? "M",
                ...row.variant.measures,
              },
            });
            measurementsCreated++;
          }

          // Image
          if (row.variant?.imageUrl) {
            await tx.productImage.create({
              data: { tenantId, productId: product.id, url: row.variant.imageUrl, position: 0 },
            });
            imagesCreated++;
          }
        }
      }
    }
  });

  await audit({
    tenantId,
    actor: `user:${s.userId}`,
    action: "product.csv_v2_imported",
    resource: "product",
    newValue: { productsCreated, variantsCreated, measurementsCreated, imagesCreated, errorCount: errors.length } as never,
  });

  return ok({ productsCreated, variantsCreated, measurementsCreated, imagesCreated, errors: errors.slice(0, 100) }, { requestId });
}

/** GET: Column mapping template + sample */
export async function GET() {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);

  const sampleHeaders = [
    "name",
    "nameAr",
    "description",
    "descriptionAr",
    "brand",
    "basePrice",
    "currency",
    "sku",
    "color",
    "size",
    "qty",
    "chest",
    "length",
    "shoulder",
    "sleeve",
    "imageUrl",
  ];

  const sampleRow = [
    "Classic Tee",
    "تيشيرت كلاسيك",
    "Premium cotton tee",
    "تيشيرت قطن ممتاز",
    "MyBrand",
    "29900",
    "EGP",
    "TEE-BLK-M",
    "Black",
    "M",
    "10",
    "104",
    "72",
    "46",
    "22",
    "https://example.com/tee-black.jpg",
  ];

  return ok({
    headers: sampleHeaders,
    sampleRow,
    validFields: VALID_FIELDS,
    requiredFields: REQUIRED_FIELDS,
    notes: [
      "Headers are case-insensitive and whitespace-trimmed",
      "Use 'columnMap' in POST to remap your CSV headers to these fields",
      "SKU is optional — auto-generated if omitted (collision-checked)",
      "imageUrl: fetched server-side, must be valid image ≤10MB",
      "Measurements in cm (chest/length/shoulder/sleeve) attached to size",
      "dryRun=1 to preview without writing",
    ],
  }, { requestId });
}