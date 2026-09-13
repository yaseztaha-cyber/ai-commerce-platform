import { Errors, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession } from "@/server/auth";

/** Platform admin: list tenants + health. Admin flag re-read from DB (never trust the token cache after demotion). */
export async function GET() {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  const { prisma } = await import("@ai-commerce/database");
  const fresh = await prisma.user.findUnique({ where: { id: s.userId }, select: { isPlatformAdmin: true } });
  if (!fresh?.isPlatformAdmin) return Errors.forbidden(requestId);
  const tenants = await prisma.tenant.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { _count: { select: { orders: true, products: true, customers: true } } } });
  return ok({ tenants }, { requestId });
}
