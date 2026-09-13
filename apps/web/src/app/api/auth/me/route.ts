import { prisma } from "@ai-commerce/database";
import { Errors, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession } from "@/server/auth";

export async function GET() {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  const tenant = await prisma.tenant.findUnique({ where: { id: s.tenantId } });
  return ok({ user: { id: s.userId, email: s.email, role: s.role }, tenant }, { requestId });
}
