# YASEZ Commerce — What This Project Does

## One-line summary

**YASEZ Commerce is a multi-tenant AI sales employee for small businesses.**
A shop connects its messaging channel (WhatsApp, website chat), customers
write naturally in Arabic or English, and the AI understands the request,
checks **real** inventory and prices, builds the order, confirms it with the
customer, notifies the shop, and hands difficult conversations to a human.

Clothing stores are the first target vertical; the architecture is reusable
for restaurants, salons, electronics, furniture, and service businesses.

---

## The core flow (example)

```text
Customer (WhatsApp):  "عايز تيشيرت اوفرسايز اسود مقاس L"
AI:                   searches catalog → finds Oversized T-Shirt
                      checks live stock → Black / L available
                      "الأوردر: تيشيرت أوفرسايز — Black / L — ×1
                       450 + شحن 60 = 510 جنيه. أأكد الأوردر؟"
Customer:             "اكد"
Backend:              validates → reserves stock transactionally →
                      creates order #1074 → decrements inventory
AI:                   "تم تأكيد الأوردر ✅ رقم #1074"
Shop:                 receives NEW ORDER notification, prepares it,
                      marks READY → customer gets a status update
```

Every factual claim (price, stock, delivery fee, order number) comes from
verified backend tools — the AI never invents them.

---

## What the platform includes

### For the business owner (dashboard)
- **Overview** — today's orders, revenue, conversion, handoffs, low stock
- **Inbox** — live customer conversations with AI/human state, manual reply,
  takeover, resume-AI, resolve, delivery ticks (sent / failed)
- **Orders** — full lifecycle (Draft → Confirmed → Processing → Ready →
  Out for delivery → Completed, plus Cancelled/Returned/Refunded), every
  transition validated and logged with actor + timestamp
- **Products & variants** — names (Arabic/English), prices, SKUs, arbitrary
  attributes (color/size/…), per-variant stock on creation, price/active
  editing, product photos (jpeg/png/webp), CSV import with preview +
  row-level errors, export
- **Quick add** — name + price + quantity in one row creates the product with
  a stocked "One Size" variant the AI can sell immediately, no interrogation
- **Inventory** — variant-level stock, every change recorded as a movement
  (actor, before → after, reason) with a visible history table; concurrent
  buyers can never oversell
- **Orders** — full lifecycle with amend-after-confirm (address anytime,
  quantities while CONFIRMED with atomic re-reservation), returns and
  cancellations with optional restock, refunds recorded as status-only
- **Customers** — detail pages with profile editing, addresses, order and
  conversation history, privacy erasure on request
- **Team** — invite links with roles and 7-day expiry, public accept page,
  rank-enforced invites, revocation (OWNER/ADMIN)
- **Notifications** — owner alerts (new orders, escalations) via WhatsApp,
  webhook, or log, with honest SENT/FAILED records
- **Workers** — embedded queue by default, standalone Redis worker process
  (`npm run worker`) for production
- **Knowledge base** — policies/FAQs/guides with versioning; the AI answers
  from these but can never take instructions from them
- **AI Playground** — test the agent as a customer and watch which tools it uses
- **Size intelligence** - per-product measurement tables, AI size advice from
  real numbers (never invented), and opt-in buyer-size memory
- **Promotions** - percent/fixed/bundles/free-shipping computed by the backend
  engine (the AI quotes, never invents), plus one-time abandoned-cart nudges
- **Courier integration** - Bosta (Egypt) shipping provider with "Book pickup" on orders, tracking webhooks, automatic status transitions (READY → OUT_FOR_DELIVERY → COMPLETED/RETURNED), sandbox mode for dev
- **Multi-channel messaging** - WhatsApp, Instagram Messaging, and Facebook Messenger via unified `MessagingProvider` interface with webhook verification, HMAC signatures, native image sends, and per-channel dashboard connect guides
- **AI Settings / Channels / Analytics / Settings** — personality, WhatsApp
  webhook setup, real metrics, plan usage, delivery/payment configuration
- **Onboarding checklist** — live progress (products → stock → delivery →
  knowledge → channel → test → activate)
- **Onboarding power tools** — 3-step Quick-Add Wizard, Bulk Variant Generator (color × size matrix, auto-SKUs, collision-checked), CSV v2 Import (column mapping, per-row errors, photo URLs)

### For the customer (chat side)
- Natural Arabic (Egyptian dialect), English, or mixed — including
  misspellings, missing spaces, and transliteration ("tshirt aswad")
- Price questions answered with the verified price, out-of-stock variants
  get real alternatives, ambiguous products get a clarification question
- Explicit confirmation before anything is ordered; order status updates
- One-tap escalation to a human at any time ("عايز اكلم حد")

### Under the hood
- **Agent architecture**: LLM does language understanding + tool selection;
  deterministic backend owns stock, prices, math, orders, and permissions.
  16 typed, tenant-scoped, audited tools (no raw SQL, no cross-tenant reads).
- **Providers**: OpenRouter primary → fallback model → OpenCode Zen →
  safe reply + human handoff. Classified errors (auth/rate-limit/5xx/timeout),
  bounded retries, token/cost tracking. Offline deterministic engine by default.
- **RAG**: hybrid keyword-IDF + semantic retrieval over business documents,
  strictly tenant-isolated, with a scored evaluation suite.
- **Multi-tenancy**: every tenant has isolated products, inventory, customers,
  orders, conversations, knowledge, AI voice, channels, team, and plan limits
  (Starter/Growth/Scale with server-enforced usage metering).
- **Reliability**: idempotent webhooks and order confirms, atomic inventory
  decrement, atomic order numbering, Redis-backed queue with retries and
  dead-letter tracking, structured redacted logs, AI run observability.
- **Security**: JWT httpOnly sessions with RBAC, production boot refuses weak
  secrets, rate limits, upload caps, prompt-injection tested, secrets stay
  server-side only (verified by automated boundary tests).

---

## Tech stack

Next.js 14 + TypeScript (strict) · PostgreSQL 16 + Prisma · Redis (optional,
in-process fallback for dev) · Tailwind CSS · Vitest · ESLint · Docker Compose.

## Repository layout

```text
apps/web          UI + API + AI agent + workers (the deployable app)
packages/shared   pricing engine, state machines, Arabic search, schemas
packages/database Prisma schema, migrations, seed data
docs/             architecture, API, security, models, deployment, privacy…
```

## Run it locally

```bash
cp .env.example .env
docker compose up -d postgres redis
npm install
npm run db:migrate --workspace=packages/database
npm run db:seed --workspace=packages/database
npm run dev
```

Open `http://localhost:3000` · demo login `owner@yasez.fashion / Yasez123!`
(dev only) · test the agent at **Dashboard → AI Playground**.

## Verify it

```bash
npm run lint          # static analysis, must exit 0
npm run typecheck     # strict TypeScript, zero errors
npm test              # 15 shared + 54 app tests (unit + integration + security)
npm run build --workspace=apps/web
```

## Documentation map

| File | Contents |
|---|---|
| `docs/ARCHITECTURE.md` | System design + responsibility boundaries |
| `docs/AI_AGENT_RULES.md` | Agent loop, tools, safety policies |
| `docs/API.md` | Endpoint reference |
| `docs/MODELS.md` | OpenRouter/OpenCode setup, free models, fallback |
| `docs/RAG.md` | Knowledge pipeline + retrieval design |
| `docs/ENVIRONMENT.md` | Every env variable, required/secret/dev/prod |
| `docs/DEPLOYMENT.md` | Production topology, backups, WhatsApp, rotation |
| `docs/SECURITY.md` / `TESTING.md` / `WHATSAPP.md` / `PRIVACY.md` | As named |
