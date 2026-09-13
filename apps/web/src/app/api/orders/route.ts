import { prisma } from "@ai-commerce/database";
import { Errors, fail, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession } from "@/server/auth";

export async function GET(req: Request) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const orders = await prisma.order.findMany({
    where: { tenantId: s.tenantId, ...(status ? { status } : {}) },
    include: { items: true, customer: { select: { name: true, phone: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return ok({ orders }, { requestId });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  void params;
  return fail("NOT_FOUND", "Use /api/orders/[id]/status", { status: 404, requestId: newRequestId() });
}
