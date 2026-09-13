import { prisma } from "@ai-commerce/database";
import { Errors, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";
import { deleteProductImage } from "@/server/storage";
import { audit } from "@/server/audit";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "MANAGER");
  } catch {
    return Errors.forbidden(requestId);
  }
  const image = await prisma.productImage.findFirst({ where: { id: params.id, tenantId: s.tenantId } });
  if (!image) return Errors.notFound(requestId, "Image");
  await prisma.productImage.delete({ where: { id: image.id } });
  await deleteProductImage(s.tenantId, image.url);
  await audit({ tenantId: s.tenantId, actor: `user:${s.userId}`, action: "product.image_deleted", resource: "product", resourceId: image.productId });
  return ok({ deleted: true }, { requestId });
}
