import { prisma } from "@ai-commerce/database";
import { Errors, isBodyTooLarge, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";
import { knowledgeUpsertSchema } from "@ai-commerce/shared";
import { ingestDocument } from "@/server/rag/ingest";

export async function GET() {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  const docs = await prisma.document.findMany({ where: { tenantId: s.tenantId }, orderBy: { updatedAt: "desc" }, take: 100 });
  return ok({ documents: docs }, { requestId });
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
  // Untrusted upload: hard cap before parsing (ingestDocument caps content further).
  if (isBodyTooLarge(req, 512 * 1024)) return Errors.tooLarge(requestId, 512);
  const body = await req.json().catch(() => null);
  const parsed = knowledgeUpsertSchema.safeParse(body);
  if (!parsed.success) return Errors.validation(requestId, parsed.error.flatten());
  try {
    const res = await ingestDocument({ tenantId: s.tenantId, title: parsed.data.title, type: parsed.data.type, language: parsed.data.language, content: parsed.data.content, productId: parsed.data.productId });
    return ok(res, { requestId, status: 201 });
  } catch (err) {
    return Errors.validation(requestId, err instanceof Error ? err.message : "ingest failed");
  }
}
