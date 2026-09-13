# AI Commerce — Sales & Order Agent SaaS

Multi-tenant AI employee for small businesses (clothing first, extensible to
restaurants, salons, electronics…). Customers chat naturally (Arabic-first);
the agent checks **real** inventory/prices via typed tools, confirms orders
transactionally, notifies the shop, and hands off to humans when needed.

## Quickstart

```bash
cp .env.example .env
docker compose up -d postgres redis
npm install
npm run db:migrate --workspace=packages/database
npm run db:seed --workspace=packages/database
npm run dev
```

Open http://localhost:3000 · Demo login: `owner@yasez.fashion` / `Yasez123!`

## MVP end-to-end (26 steps, spec §100)

Sign up → create store → add product + variants + stock → set delivery fee →
configure AI → customer messages (playground or WhatsApp) → AI searches,
checks stock, replies, collects info, calculates via backend, asks confirmation
→ customer confirms → transactional order + stock decrement → confirmations to
customer + shop → status change notifies customer → full history preserved.

Try it: `/dashboard/playground` → “عايز التيشيرت الأسود مقاس L” → “اه” →
“اكد”.

## Structure

```
apps/web            Next.js 14 (API + dashboard + landing)
  src/server        auth, products, inventory, orders, customers,
                    conversations, messaging, webhooks, queue,
                    ai (llm/tools/agent/prompts/embeddings),
                    rag, notifications, n8n, analytics
packages/shared     zod schemas, pricing engine, state machines, Arabic NLP
packages/database   Prisma schema, migrations, seed
docs/               ARCHITECTURE, AI_AGENT_RULES, RAG, API, SECURITY,
                    TESTING, WHATSAPP, DEPLOYMENT
```

## Docs

Start with `docs/ARCHITECTURE.md` and `docs/AI_AGENT_RULES.md`.
LLM gateways, free-model selection, and fallback chain: `docs/MODELS.md`.
Production env + secret rotation: `docs/DEPLOYMENT.md`.

## AI providers

Default is the offline rule-based engine (`LLM_PROVIDER=rulebased`).
For live models set `LLM_PROVIDER=composite` plus `OPENROUTER_API_KEY`
and/or `OPENCODE_API_KEY` in your own shell — never commit keys.
