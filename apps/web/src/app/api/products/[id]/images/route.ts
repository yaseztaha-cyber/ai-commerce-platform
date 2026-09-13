import { prisma } from "@ai-commerce/database";
import { Errors, fail, isBodyTooLarge, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";
import { saveProductImage } from "@/server/storage";
import { audit } from "@/server/audit";

/** Upload a product image (jpeg/png/webp, ≤5MB). Optionally attach to a variant. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "MANAGER");
  } catch {
    return Errors.forbidden(requestId);
  }
  if (isBodyTooLarge(req, 6 * 1024 * 1024)) return Errors.tooLarge(requestId, 6144);
  const product = await prisma.product.findFirst({ where: { id: params.id, tenantId: s.tenantId } });
  if (!product) return Errors.notFound(requestId, "Product");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Errors.validation(requestId, "Expected multipart form with a 'file' field");
  }
  const file = form.get("file");
  const variantId = (form.get("variantId") as string | null) || null;
  const alt = ((form.get("alt") as string | null) || "").slice(0, 200) || null;
  if (!(file instanceof Blob)) return Errors.validation(requestId, "Missing image file");
  if (variantId) {
    const v = await prisma.productVariant.findFirst({ where: { id: variantId, tenantId: s.tenantId, productId: product.id } });
    if (!v) return Errors.validation(requestId, "Variant does not belong to this product");
  }
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const { url } = await saveProductImage(s.tenantId, bytes, file.type);
    const maxPos = await prisma.productImage.findFirst({ where: { productId: product.id }, orderBy: { position: "desc" }, select: { position: true } });
    const image = await prisma.productImage.create({
      data: { tenantId: s.tenantId, productId: product.id, variantId, url, alt, position: (maxPos?.position ?? -1) + 1 },
    });
    await audit({ tenantId: s.tenantId, actor: `user:${s.userId}`, action: "product.image_added", resource: "product", resourceId: product.id, newValue: { imageId: image.id } });
    return ok({ image }, { requestId, status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Upload failed";
    if (msg.startsWith("UNSUPPORTED_TYPE") || msg.startsWith("TOO_LARGE")) {
      return fail("INVALID_IMAGE", msg, { status: 422, requestId });
    }
    return fail("UPLOAD_FAILED", "Could not store image", { status: 500, requestId });
  }
}
