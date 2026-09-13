# API

Base: `/api`. Envelope: `{ ok: true, data, requestId }` or
`{ ok: false, error: { code, message, details }, requestId }`.

## Auth

- `POST /api/auth/register` — creates user + tenant + OWNER membership, sets session cookie.
- `POST /api/auth/login` — sets session cookie (httpOnly, SameSite=Lax).
- `POST /api/auth/logout`, `GET /api/auth/me`.

Roles: `OWNER > ADMIN > MANAGER > AGENT > VIEWER`. Reads need membership;
writes need `MANAGER+` (products/inventory/knowledge/settings), inbox replies
need `AGENT+`, playground needs `ADMIN+`.

## Domains

- `GET/POST /api/products`, `POST /api/variants`, `POST/GET /api/products/import` (CSV)
- `GET/POST /api/inventory` (every POST writes `InventoryMovement`)
- `GET /api/customers`
- `GET /api/orders`, `GET /api/orders/[id]`, `POST /api/orders/[id]/status`
- `GET /api/conversations`, `GET/POST /api/conversations/[id]`,
  `POST /api/conversations/[id]/takeover`
- `GET/POST /api/knowledge`, `DELETE /api/knowledge/[id]`
- `POST /api/ai/test` (playground, ADMIN+, 30/min/IP budget)
- `GET/POST /api/channels/whatsapp` (Meta verify + receive, `?tenant=<slug>`)
- `POST /api/webchat/message` (`{ tenant, from, text }`)
- `GET /api/analytics/overview`, `GET/PUT /api/settings`
- `GET /api/admin/tenants` (platform admin only), `GET /api/health`

## Billing (Fawry, EGP)

Plans: Starter 0, Growth 499/mo, Scale 1999/mo. Limits enforced server-side
(AI messages + documents per period; products, seats, documents on create).

- `GET /api/billing/status` — subscription, usage vs caps, trial/period ends, plans.
- `POST /api/billing/checkout` (OWNER, `{ planSlug, phone? }`) — issues a
  Fawry hosted-payment URL. Paid targets only; each call rotates the ref and
  clears the previous attempt marker. First checkout with a phone grants a
  once-ever 14-day trial.
- `POST /api/billing/portal` (OWNER) — fresh payment link for the current plan.
- `POST /api/billing/downgrade` (OWNER, `{ planSlug }`) — immediate switch to
  a cheaper plan (free included; clears pending refs, clears PAST_DUE on free).
  Upgrades go through checkout. Existing over-limit resources keep working;
  creation gates block only new usage.
- `POST /api/billing/callback` (Fawry server webhook, GET+POST) — fail-closed
  signature check, idempotent per ref; paid extends 30 days, failed marks
  PAST_DUE (trial grace keeps ACTIVE).
- `POST /api/cron/renew-subscriptions` (`x-cron-secret`, daily) — expired subs
  move to PAST_DUE and the owner is emailed a fresh checkout link.

## Webhooks & idempotency

WhatsApp `POST` requires `?tenant=<slug>` and passes HMAC verification.
`(tenantId, providerMessageId)` is unique on `WebhookEvent` and `Message` —
retried deliveries return `DUPLICATE` without side effects.
