# RAG

Structured data (products, variants, prices, inventory, orders, fees) is **never**
retrieved via RAG — only via typed tools. RAG covers: business description,
FAQs, return/exchange/shipping policies, sizing guides, care, promotions.

## Pipeline

`Upload → Validate → Extract → Normalize → Chunk (600 chars, 80 overlap) →
Metadata → Embeddings → Store → Index → Ready`

Document status: `UPLOADED → PROCESSING → READY | FAILED` (errors in dashboard).

Every chunk stores metadata: `tenant_id, document_id, document_type, source,
product_id?, language, created_at`. Retrieval always filters `tenantId`.

## Retrieval (hybrid)

`semantic cosine + keyword token-overlap + substring boost + tenant filter →
weighted rerank (0.55 keyword + boost + 0.45 semantic) → top-K`

Pure transactional queries hit tools first; mixed queries
(“الأسود XL موجود ومدة الاستبدال كام؟”) call **both** inventory tools and RAG,
then combine verified results.

## Embeddings

`EmbeddingProvider` abstraction: `local` (deterministic 1536-dim hash vectors,
zero cost, offline) vs `openai` (`text-embedding-3-small`, 1536 dims).
Same dimension → interchangeable.

## Scaling to pgvector

Chunks store `embedding Json` today (portable, fine to ~100k chunks with the
500-row candidate window). For scale: enable `pgvector`, add
`embedding vector(1536)` + `ivfflat` index, replace the JS cosine pass with
`<=>` ordering in `retrieveKnowledge`. No API changes needed.
