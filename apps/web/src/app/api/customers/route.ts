import { prisma } from "@ai-commerce/database";
import { Errors, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession } from "@/server/auth";

export async function GET(req: Request) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const customers = await prisma.customer.findMany({
    where: { tenantId: s.tenantId, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] } : {}) },
    orderBy: { lastSeenAt: "desc" },
    take: 100,
  });
  return ok({ customers }, { requestId });
}
