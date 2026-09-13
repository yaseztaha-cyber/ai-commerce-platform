import { prisma } from "@ai-commerce/database";
import { normalizeSearchText, searchTokens } from "@ai-commerce/shared";
import { cosineSimilarity, getEmbeddingProvider } from "../ai/embeddings";

export interface KnowledgeHit {
  title: string;
  content: string;
  score: number;
  documentId: string;
}

/**
 * Hybrid retrieval: semantic (cosine over embeddings) + keyword
 * (normalized substring/token overlap) + metadata filter (tenant always)
 * + lightweight rerank (weighted blend). Tenant isolation enforced in query.
 */
export async function retrieveKnowledge(tenantId: string, query: string, topK = 4): Promise<KnowledgeHit[]> {
  const chunks = await prisma.documentChunk.findMany({
    where: { tenantId, document: { status: "READY" } },
    include: { document: { select: { id: true, title: true, type: true } } },
    take: 500,
    orderBy: { createdAt: "desc" },
  });
  if (chunks.length === 0) return [];

  const nq = normalizeSearchText(query);
  // Prefix-tolerant tokens on both sides ("للقاهرة" matches "القاهرة").
  const qTokens = new Set(searchTokens(query));

  let queryVec: number[] | null = null;
  try {
    queryVec = (await getEmbeddingProvider().embed([query]))[0] ?? null;
  } catch {
    queryVec = null;
  }

  const scored = chunks.map((c) => ({ c, tokens: new Set(searchTokens(c.content)) }));

  // IDF over the candidate set: rare discriminative tokens (e.g. a city or
  // policy name) outweigh generic question words (e.g. "قد ايه").
  const df = new Map<string, number>();
  for (const s of scored) for (const t of s.tokens) df.set(t, (df.get(t) ?? 0) + 1);
  const N = Math.max(1, scored.length);
  const idf = (t: string) => Math.log(1 + N / (df.get(t) ?? N));
  const qWeight = [...qTokens].reduce((sum, t) => sum + idf(t), 0) || 1;

  const rescored = scored.map(({ c, tokens: cTokens }) => {
    // IDF-weighted keyword score
    let matched = 0;
    for (const t of qTokens) if (cTokens.has(t)) matched += idf(t);
    const keyword = matched / qWeight;
    const nc = normalizeSearchText(c.content);
    const substringBoost = nc.includes(nq) && nq.length > 2 ? 0.3 : 0;

    // semantic score
    let semantic = 0;
    if (queryVec && Array.isArray(c.embedding)) {
      try {
        semantic = Math.max(0, cosineSimilarity(queryVec, c.embedding as unknown as number[]));
      } catch {
        semantic = 0;
      }
    }

    // rerank blend: IDF-weighted keyword dominates (dialect paraphrase is
    // noisy for hash embeddings); semantic breaks near-ties. Tuned on
    // src/server/rag/eval.test.ts — retune deliberately, not by feel.
    const score = 0.7 * keyword + substringBoost + 0.3 * semantic;
    return { c, score, keyword };
  });

  return rescored
    .filter((s) => s.score > 0.02)
    .sort((a, b) => b.score - a.score || b.keyword - a.keyword || a.c.document.title.localeCompare(b.c.document.title))
    .slice(0, topK)
    .map((s) => ({ title: s.c.document.title, content: s.c.content, score: Number(s.score.toFixed(3)), documentId: s.c.documentId }));
}
