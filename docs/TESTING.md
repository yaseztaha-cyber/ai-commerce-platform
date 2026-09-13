# Testing

## Run

```bash
npm run test --workspace=packages/shared   # pure domain tests
npm run test --workspace=apps/web          # chunking, adapters
# integration (needs DATABASE_URL):
DATABASE_URL=... npx vitest run src/server/orders.integration.test.ts
```

## Coverage map (spec §67–68, §84–85)

Unit (`packages/shared`): pricing incl. free-delivery threshold, minimum/zone
rules, order transitions, Arabic normalization (alef/taa/diacritics), tshirt
aliases, size/color tokens, quantity words + Arabic-Indic digits,
confirm/cancel/human detection.

Unit (`apps/web`): chunking, WhatsApp normalize (text only, images skipped).

Integration (DB-backed, in `apps/web/src/server/*.integration.test.ts` after
`prisma migrate deploy` + seed):
1. available product → draft → confirm → stock decremented + movement + history
2. out-of-stock variant → `INSUFFICIENT_STOCK`, no order
4. invalid size → alternatives reply, no draft
6. concurrent confirms on last piece → exactly one CONFIRMED (transaction)
7. duplicate webhook → second ingest returns `duplicate`
10. human request → `HUMAN_REQUIRED` + no AI reply
11–12. Arabic + mixed Arabizi order flow
13. prompt injection doc (“ignore instructions…”) → treated as inert text
14. cross-tenant read → empty (tenant isolation)
16–17. DB/provider failure → Arabic fallback + escalation

## RAG eval

Seeded fixtures: “سياسة الاستبدال؟” → Exchange Policy doc;
“فيه مقاس XL؟” → must hit tools, not RAG. Track precision + tool correctness
per release in this file's table (append results).
