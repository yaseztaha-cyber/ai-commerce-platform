import { config } from "@/lib/env";

export interface EmbeddingProvider {
  readonly name: string;
  readonly dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Deterministic local embeddings (hash-based, L2-normalized).
 * Lets RAG + retrieval work offline with zero API cost. Production
 * should set EMBEDDING_PROVIDER=openai. Dim stays 1536 either way.
 */
export class LocalHashEmbeddingProvider implements EmbeddingProvider {
  readonly name = "local-hash";
  readonly dim = 1536;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }

  private embedOne(text: string): number[] {
    const vec = new Array<number>(this.dim).fill(0);
    const tokens = text.toLowerCase().split(/[\s،,.!?;:()[\]{}"']+/).filter(Boolean);
    // char-trigram features + token features
    const feats: string[] = [...tokens];
    const joined = ` ${text.toLowerCase()} `;
    for (let i = 0; i < joined.length - 2; i++) feats.push(joined.slice(i, i + 3));
    for (const f of feats) {
      let h1 = 2166136261;
      for (let i = 0; i < f.length; i++) {
        h1 ^= f.charCodeAt(i);
        h1 = Math.imul(h1, 16777619);
      }
      const idx = Math.abs(h1) % this.dim;
      vec[idx] += 1;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai";
  readonly dim = 1536;
  async embed(texts: string[]): Promise<number[][]> {
    const key = process.env.OPENAI_API_KEY_FOR_EMBEDDINGS || process.env.LLM_API_KEY || config.llm.apiKey;
    if (!key) throw new Error("Embeddings API key not configured");
    const res = await fetch(`${config.llm.baseUrl}/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: texts, dimensions: 1536 }),
    });
    if (!res.ok) throw new Error(`Embedding request failed: ${res.status}`);
    const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return data.data.map((d) => d.embedding);
  }
}

export function getEmbeddingProvider(): EmbeddingProvider {
  if (config.embedding.provider === "openai") return new OpenAIEmbeddingProvider();
  return new LocalHashEmbeddingProvider();
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot; // inputs are L2-normalized
}
