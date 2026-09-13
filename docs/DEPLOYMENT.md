# n8n + Deployment

## n8n (optional, core works without it)

Set `N8N_ORDER_WEBHOOK_URL` and/or `N8N_GENERIC_WEBHOOK_URL`. Events emitted:

- `order.created` → order payload (fan out to CRM / Sheets / Slack / email)
- domain events (`customer.created`, `order.confirmed`, `human.requested`, …)

n8n is a consumer, never the source of truth — orders/inventory live in Postgres.

## Deployment

```
Web (Next.js) ─┐
Worker ────────┼─→ PostgreSQL 16 (+pgvector image) + Redis 7
```

- `docker compose up -d postgres redis` for infra.
- `npm run db:deploy --workspace=packages/database` then `npm run build && npm run start`.
- Env per `.env.example`. Backups: `pg_dump` on schedule + object-storage copy
  of product images; restore drill documented per release.
- Retention: `DELETE /api/knowledge/[id]` removes docs+embeddings; customer
  export/delete via inbox (support flow) — configurable per tenant settings.

## Production environment (required, no insecure fallbacks)
```env
NODE_ENV=production
JWT_SECRET=<≥32 random chars; server refuses to boot on weak defaults>
DATABASE_URL=<production database>
OPENROUTER_API_KEY=<key>   # or OPENCODE_API_KEY, or both for fallback chain
```

- The server throws on first request if `JWT_SECRET` is missing/weak in
  production (`assertRuntimeConfig`). Dev defaults in `.env` are gitignored
  and must never be copied to production.
- Seeds (`db:seed`) create demo users/products and must NEVER run against
  production. Migrations (`db:deploy`) are safe and idempotent.
- Secret rotation: rotate `JWT_SECRET` (invalidates sessions),
  `OPENROUTER_API_KEY` / `OPENCODE_API_KEY` (provider dashboards),
  `WHATSAPP_ACCESS_TOKEN` (Meta dashboard) independently; no code deploy
  needed — all are env-only. Never commit `.env`; `.env.example` holds
  placeholders only.
- Cookies: `HttpOnly; SameSite=Strict; Secure` when the app URL is https.
- Rate limits: auth 20/min/IP, AI playground 30/min/IP, webchat 60/min/IP,
  webhooks 300/min/IP (in-process fixed window; use a gateway/WAF for
  multi-instance deployments).

## Recommended process architecture

```text
                    HTTPS (reverse proxy / managed TLS)
                                │
               ┌────────────────┴────────────────┐
               │            Web + API            │  `next start` (stateless, ≥2 replicas)
               │   (Next.js, serves UI + API)    │
               └────────────────┬────────────────┘
                                │
               ┌────────────────┴────────────────┐
                │             Worker              │  queue consumer (same codebase,
                │   (drains Redis job queue)      │  `WORKER_ONLY=1` split)
                └────────────────┬────────────────┘
                                │
        ┌───────────────┬───────┴────────┬────────────────┐
        │               │                │                │
   PostgreSQL 16    Redis 7        Object storage   WhatsApp Cloud API
   (+pgvector)   (job queue)      (product imgs)    (Meta, official)
```

Today the worker is embedded in the web process (registers the same queue
handlers). For production, run a dedicated worker alongside the web
replicas so `process_message` jobs drain even during web deploys:

```bash
npm run worker --workspace=apps/web   # requires REDIS_URL; exits non-zero without it
```

`docker-compose.yml` already splits them: the `worker` service drains the
queue while `web` stays HTTP-only (`WORKER_ONLY=1` in the shared env tells
the web process to skip its embedded consumer; unset = embedded consumer
for dev/single-instance). The worker validates runtime config at boot,
requeues jobs orphaned by crashed workers, retries with backoff (bounded
by maxAttempts), dead-letters to `q:dead`, and shuts down gracefully on
SIGTERM/SIGINT. The in-process fallback remains development/single-instance
only (boot warns in production when `REDIS_URL` is absent).

## Domain / HTTPS

Terminate TLS at the proxy (Caddy/Nginx/managed LB). A ready-to-adapt
example ships as `Caddyfile.example` (automatic Let's Encrypt, HSTS, proxy
to `127.0.0.1:3000`). Set `NEXT_PUBLIC_APP_URL=https://<domain>` — the app
enables `Secure` cookies only for https origins and warns otherwise.
Postgres/Redis ports are localhost-bound in compose, so a prod VPS never
exposes them; the app containers reach them over the compose network.

## First platform admin (no seed in production)

`db:seed` creates demo data and must NEVER run against production, and
`/register` always creates non-admin users — so bootstrap the owner with:

```bash
# 1. Register normally at https://<domain>/register (creates user + tenant).
# 2. Flip the flag (DATABASE_URL must point at the production database):
npm run db:make-admin -- you@company.com
```

The script only adds `isPlatformAdmin` to one existing user; it never
creates users or touches tenants. Sentinels at boot also warn (not fail)
when `EMAIL_PROVIDER=log` (password resets only print to console) or no SMS
gateway is set (verification codes only print) — configure a real provider
before promising those flows.

## Migrations & rollback

- Deploy: `prisma migrate deploy` (idempotent, forward-only). Never edit an
  applied migration; add a new one.
- Rollback: restore the pre-deploy database snapshot, then deploy the
  previous image. There are no down-migrations by design — every migration
  must be backwards-compatible with the previous release for one deploy
  (expand-then-contract for renames/drops).

## Backups (script ships — scheduling is operator-owned)

```bash
# nightly database (+ local uploads) backup; keeps BACKUP_RETENTION_DAYS (default 30)
BACKUP_DIR=/var/backups/ai-commerce ./scripts/backup.sh
# restore drill (into a scratch database, never prod directly)
pg_restore -d scratch_db backups/backup-2026-01-01.dump
```

Schedule it (pick one — cron, systemd timer, or K8s CronJob with the
production env), and copy `BACKUP_DIR` off-site (object storage / second
region). Object-store product images (`STORAGE_PROVIDER=s3`) are backed up
by bucket versioning/replication where used; local `STORAGE_DIR` uploads are
tarred alongside the dump by the script.
**Do not claim backups exist unless the schedule above is actually running.**

## Scheduler (operator cron)

Both endpoints share `CRON_SECRET` (`x-cron-secret` header, timing-safe
compare, 6 req/min each, generic 403s that never leak which check failed):

```bash
# abandoned-cart nudges — every ~15 min
curl -XPOST "$APP_URL/api/cron/cart-nudge" -H "x-cron-secret: $CRON_SECRET"
# subscription renewals — daily
curl -XPOST "$APP_URL/api/cron/renew-subscriptions" -H "x-cron-secret: $CRON_SECRET"
```

## Object storage

Product images default to local disk: compose mounts a persistent `uploads`
volume at `/data/uploads` (`STORAGE_DIR`) on the `web` service, so images
survive container recreates, and `scripts/backup.sh` tars that directory
alongside the dump. For multi-instance / HA deployments set
`STORAGE_PROVIDER=s3` with `S3_ENDPOINT/S3_REGION/S3_BUCKET` plus
`S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY` and `S3_PUBLIC_BASE_URL`
(Cloudflare R2: region `auto`). Uploads are SigV4-signed PUTs (no extra
dependencies); deletes are best-effort. An incomplete s3 config falls back
to local with a warning (boot error in production). Legacy local files keep
serving from `/api/files` after a migration to s3.

## Monitoring

- Liveness: `GET /api/health` · Readiness: `GET /api/ready` (DB + Redis).
- Alert on: readiness 503, `HUMAN_REQUIRED` spikes, AI `error` runs,
  `LOW_STOCK` notifications, 5xx rate, queue depth (Redis `LLEN q:*`).
- Logs are JSON with `request_id/tenant_id/conversation_id/order_id/ai_run_id`;
  secrets are redacted at the logger. No error responses carry stack traces,
  SQL, prompts, or credentials (see `src/lib/errors.ts`).
- Optional: set `SENTRY_DSN` to forward server-side `logger.error` events as
  Sentry envelopes (no SDK, 10s timeout, never blocks requests; malformed DSN
  warns at boot and falls back to logs-only).

## WhatsApp production checklist

1. Meta app → webhook URL `https://<host>/api/channels/whatsapp?tenant=<slug>`,
   verify token = `WHATSAPP_VERIFY_TOKEN`, subscribe `messages`.
2. `WHATSAPP_APP_SECRET` set → HMAC enforced (unsigned delivery rejected).
3. `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` set → outbound sends
   real; without them sends are logged, visibly marked unconfigured, and the
   stored message keeps the failure (`error` on the message row).
4. Retried Meta deliveries dedupe on `(tenant, providerMessageId)`.
5. Human takeover (`HUMAN_ACTIVE`) silences the AI per conversation.
