import { prisma } from "@ai-commerce/database";
import { Errors, isBodyTooLarge, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";
import { reingestDocument } from "@/server/rag/ingest";
import { z } from "zod";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "MANAGER");
  } catch {
    return Errors.forbidden(requestId);
  }
  await prisma.document.deleteMany({ where: { id: params.id, tenantId: s.tenantId } });
  return ok({ deleted: true }, { requestId });
}

/** Update content: bumps version + replaces chunks atomically (no stale mix). */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "MANAGER");
  } catch {
    return Errors.forbidden(requestId);
  }
  if (isBodyTooLarge(req, 512 * 1024)) return Errors.tooLarge(requestId, 512);
  const body = await req.json().catch(() => null);
  const parsed = z.object({ content: z.string().min(1).max(200000), title: z.string().min(1).max(300).optional() }).safeParse(body);
  if (!parsed.success) return Errors.validation(requestId, parsed.error.flatten());
  try {
    const res = await reingestDocument({ tenantId: s.tenantId, documentId: params.id, content: parsed.data.content, title: parsed.data.title });
    const doc = await prisma.document.findFirst({ where: { id: params.id, tenantId: s.tenantId } });
    return ok({ ...res, version: doc?.version ?? null, status: doc?.status ?? null }, { requestId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "reingest failed";
    if (msg === "DOCUMENT_NOT_FOUND") return Errors.notFound(requestId, "Document");
    return Errors.validation(requestId, msg);
  }
}
