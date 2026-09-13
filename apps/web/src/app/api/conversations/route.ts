import { prisma } from "@ai-commerce/database";
import { Errors, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession } from "@/server/auth";

export async function GET(req: Request) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const convos = await prisma.conversation.findMany({
    where: { tenantId: s.tenantId, ...(status ? { status } : {}) },
    include: { customer: { select: { name: true, phone: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { lastMessageAt: "desc" },
    take: 100,
  });
  return ok({ conversations: convos }, { requestId });
}
