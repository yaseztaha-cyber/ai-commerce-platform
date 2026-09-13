import { prisma } from "@ai-commerce/database";
import { chunkText } from "./chunk";
import { getEmbeddingProvider } from "../ai/embeddings";
import { checkLimit, meter } from "../billing";

/**
 * Ingestion pipeline: Upload -> Validate -> Extract -> Normalize ->
 * Chunk -> Metadata -> Embeddings -> Store -> Index -> Ready.
 * Document status tracked; errors surfaced in dashboard.
 */
export async function ingestDocument(input: {
  tenantId: string;
  title: string;
  type?: string;
  language?: string;
  source?: string;
  content: string;
  productId?: string | null;
}) {
  const content = input.content.trim();
  if (!content) throw new Error("EMPTY_DOCUMENT");
  if (content.length > 200_000) throw new Error("DOCUMENT_TOO_LARGE");
  const gate = await checkLimit(input.tenantId, "document");
  if (!gate.allowed) throw new Error(`PLAN_LIMIT: ${gate.message}`);

  const doc = await prisma.document.create({
    data: {
      tenantId: input.tenantId,
      title: input.title,
      type: input.type ?? "TEXT",
      language: input.language ?? "ar",
      source: input.source,
      status: "PROCESSING",
      version: 1,
    },
  });

  try {
    await indexDocumentContent({ tenantId: input.tenantId, documentId: doc.id, content, productId: input.productId ?? null, type: input.type ?? "TEXT", language: input.language ?? "ar", source: input.source });
  } catch (err) {
    await prisma.document.update({
      where: { id: doc.id },
      data: { status: "FAILED", error: err instanceof Error ? err.message.slice(0, 500) : "ingest failed" },
    });
    throw err;
  }
  return { documentId: doc.id, chunks: (await prisma.document.findUnique({ where: { id: doc.id }, select: { chunkCount: true } }))?.chunkCount ?? 0 };
}

/**
 * Re-index new content for an existing document: old chunks are deleted and
 * the version bumped atomically, so retrieval never mixes stale + fresh text.
 */
export async function reingestDocument(input: { tenantId: string; documentId: string; content: string; title?: string }) {
  const content = input.content.trim();
  if (!content) throw new Error("EMPTY_DOCUMENT");
  if (content.length > 200_000) throw new Error("DOCUMENT_TOO_LARGE");
  const doc = await prisma.document.findFirst({ where: { id: input.documentId, tenantId: input.tenantId } });
  if (!doc) throw new Error("DOCUMENT_NOT_FOUND");
  await prisma.$transaction([
    prisma.documentChunk.deleteMany({ where: { documentId: doc.id } }),
    prisma.document.update({ where: { id: doc.id }, data: { status: "PROCESSING", version: { increment: 1 }, ...(input.title ? { title: input.title } : {}) } }),
  ]);
  try {
    await indexDocumentContent({ tenantId: input.tenantId, documentId: doc.id, content, productId: null, type: doc.type, language: doc.language, source: doc.source });
  } catch (err) {
    await prisma.document.update({
      where: { id: doc.id },
      data: { status: "FAILED", error: err instanceof Error ? err.message.slice(0, 500) : "reingest failed" },
    });
    throw err;
  }
  return { documentId: doc.id };
}

async function indexDocumentContent(input: {
  tenantId: string;
  documentId: string;
  content: string;
  productId: string | null;
  type: string;
  language: string;
  source?: string | null;
}) {

  const chunks = chunkText(input.content);
  if (chunks.length === 0) throw new Error("NO_CONTENT_EXTRACTED");
  const provider = getEmbeddingProvider();
  const BATCH = 16;
  let stored = 0;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const vectors = await provider.embed(batch.map((c) => c.content));
    await prisma.$transaction(
      batch.map((c, j) =>
        prisma.documentChunk.create({
          data: {
            tenantId: input.tenantId,
            documentId: input.documentId,
            productId: input.productId ?? null,
            chunkIndex: c.index,
            content: c.content,
            tokenCount: c.tokenCount,
            embedding: vectors[j] as never,
            embeddingModel: provider.name,
            metadata: {
              tenant_id: input.tenantId,
              document_id: input.documentId,
              document_type: input.type ?? "TEXT",
              source: input.source ?? "dashboard",
              product_id: input.productId ?? null,
              language: input.language ?? "ar",
            } as never,
          },
        })
      )
    );
    stored += batch.length;
  }
  await prisma.document.update({ where: { id: input.documentId }, data: { status: "READY", chunkCount: stored } });
  void meter(input.tenantId, "document");
}
