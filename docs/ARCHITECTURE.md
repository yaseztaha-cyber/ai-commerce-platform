# Architecture

Monorepo: `apps/web` (Next.js 14 App Router, full-stack) + `packages/shared`
(pure domain logic) + `packages/database` (Prisma + PostgreSQL).

```
Customer → Channel adapter (WhatsApp/Website/Simulator)
  → Webhook receiver (verify → idempotency → normalize → queue)
  → Conversation processor → AI agent → typed tools → PostgreSQL
  → reply via channel adapter + business/customer notifications
```

## Responsibility boundaries (non-negotiable)

| Layer | Owns |
|---|---|
| LLM | language understanding, intent, entity extraction, tool choice, phrasing |
| Backend | stock, prices, math, order creation, permissions, tenant isolation, transitions |
| Database | source of truth for business data |
| RAG | source of truth for unstructured knowledge (policies, FAQs) |
| Messaging adapter | transport only |
| State machine | order + conversation workflow |
| AuthZ | access control |

The LLM never writes to critical tables directly — only via validated tools
that take `tenantId` from server context.

## Multi-tenancy

Every business row carries `tenantId`. All service functions require it and
filter by it. Compound uniques (`tenant+phone`, `tenant+sku`, `tenant+number`,
`tenant+providerMessageId`) enforce isolation at the DB layer. Tests assert
cross-tenant access returns nothing.

## Request flow

1. `POST /api/channels/whatsapp?tenant=<slug>` verifies HMAC-SHA256,
   normalizes Meta payload, creates `WebhookEvent` (unique tenant+message id).
2. Duplicate delivery → `DUPLICATE`, no reprocessing.
3. `ingestInbound` finds/creates customer + conversation, stores the message,
   enqueues `process_message` (Redis when `REDIS_URL` set, else in-memory).
4. `processMessageJob` runs `runAgentTurn`, persists the assistant message,
   sends via the channel adapter, logs `AiRun` + `ToolCall`s.

## Scaling path

Web (Next.js) + Worker (queue consumer) + PostgreSQL + Redis + object storage
for images + pgvector for embeddings at scale (see `docs/RAG.md`). Current
build runs as one deployable with an embedded worker for simplicity.
