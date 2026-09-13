# Environment variables

Legend: **Req** = required · **Scope**: `server` (never leaves Node) vs
`public` (embedded in the browser bundle — never put secrets here).

Only `NEXT_PUBLIC_APP_URL` is public. Everything else is server-only.
Validated at boot by `validateRuntimeConfig` (`src/lib/config-check.ts`):
production **refuses to start** on errors, development only warns.

## Core

| Variable | Req | Scope | Notes |
|---|---|---|---|
| `DATABASE_URL` | prod: yes | server, secret | `postgresql://…`. Must be postgres scheme. |
| `JWT_SECRET` | prod: yes | server, secret | ≥32 chars, non-default. Rotation invalidates sessions. |
| `NODE_ENV` | — | server | `production` enables strict boot validation. |
| `NEXT_PUBLIC_APP_URL` | yes | **public** | Full origin, e.g. `https://shop.example.com`. Prod warns if not https (cookies lose `Secure`). |
| `SESSION_COOKIE_NAME` | no | server | Default `ac_session`. |
| `SESSION_TTL_HOURS` | no | server | Default `168`. |
| `POSTGRES_USER/PASSWORD/DB/PORT` | compose | server | Only for `docker-compose.yml`. |
| `PORT` | no | server | Next.js listen port (default 3000). |

## AI providers

| Variable | Req | Scope | Notes |
|---|---|---|---|
| `LLM_PROVIDER` | no | server | `rulebased` (default, offline-safe) \| `openrouter` \| `opencode` \| `composite` \| `openai` (legacy). Network providers with **no key** = boot error in prod. |
| `LLM_MODEL` | no | server | Primary model slug, e.g. `z-ai/glm-5.2:free`. See `docs/MODELS.md` — free catalogs rotate. |
| `LLM_FALLBACK_MODEL` | no | server | Second model on the primary gateway. |
| `LLM_MODEL_AGENT/SIMPLE/EXTRACT/COMPLEX/RAG` | no | server | Per-task overrides; empty = primary. |
| `LLM_MAX_TOKENS` | no | server | Default `1024` — per-request output cap (cost control). |
| `LLM_MAX_TOOL_CALLS` | no | server | Default `8` — agent loop bound (no infinite loops). |
| `LLM_TIMEOUT_MS` | no | server | Default `45000` — per-attempt timeout. |
| `LLM_MAX_RETRIES` | no | server | Same-provider retries, `0..2` (default `1`). |
| `LLM_TEMPERATURE` | no | server | Default `0.2`. |
| `OPENROUTER_API_KEY` | prod-AI | server, secret | Empty in `.env.example`. Never log, never send to browser. |
| `OPENROUTER_BASE_URL` | no | server | Default `https://openrouter.ai/api/v1`. |
| `OPENCODE_API_KEY` | prod-AI | server, secret | Fallback gateway key. Same secrecy rules. |
| `OPENCODE_BASE_URL` | no | server | Default `https://opencode.ai/zen/v1`. |
| `OPENCODE_MODEL` | no | server | Default `deepseek-v4-flash-free`. |
| `LLM_API_KEY/BASE_URL` | no | server, secret | Legacy plain-OpenAI path only. |

## Voice transcription (leak 1B)
| Variable | Req | Scope | Notes |
|---|---|---|---|
| `TRANSCRIBE_API_KEY` | to enable | server, secret | Empty = voice notes get the instant text fallback. Never log, never browser. |
| `TRANSCRIBE_BASE_URL` | no | server | Whisper-compatible endpoint. Default `https://api.openai.com/v1`. |
| `TRANSCRIBE_MODEL` | no | server | Default `whisper-1`. |
| `TRANSCRIBE_LANGUAGE` | no | server | BCP-47 hint, default `ar`. Empty = auto-detect. |
| `TRANSCRIBE_TIMEOUT_MS` | no | server | Default `30000`. Timeout → bounded retry, then fallback. |
| `TRANSCRIBE_MAX_BYTES` | no | server | Default 25MB. Oversize → immediate fallback, no download buffering past cap. |

## Inbound sight (leak 2B)

| Variable | Req | Scope | Notes |
|---|---|---|---|
| `VISION_API_KEY` | to enable | server, secret | Empty = photos get the instant text fallback. Never log, never browser. |
| `VISION_BASE_URL` | no | server | OpenAI-compatible chat endpoint. Default `https://api.openai.com/v1`. |
| `VISION_MODEL` | no | server | Must support image inputs. Default `gpt-4o-mini`. |
| `VISION_TIMEOUT_MS` | no | server | Default `30000`. Timeout → bounded retry, then fallback. |
| `VISION_MAX_BYTES` | no | server | Default 10MB. |
| `VISION_MIN_CONFIDENCE` | no | server | Default `0.7`. Below → text fallback, never a guessed product. |
| `VISION_MAX_PER_CONVERSATION` | no | server | Default `5`. Bounds cost on photo dumps. |

## Phone verification / SMS (leak 7)

| Variable | Req | Scope | Notes |
|---|---|---|---|
| `SMS_WEBHOOK_URL` | for SMS | server, secret | Generic JSON gateway (`{to, text}`). Empty + no Twilio = log driver (dev). |
| `TWILIO_ACCOUNT_SID` | for Twilio | server, secret | Takes precedence over webhook when fully set. |
| `TWILIO_AUTH_TOKEN` | for Twilio | server, secret | Basic-auth, never logged. |
| `TWILIO_FROM` | for Twilio | server | Sender number. |

Tenant toggle: `requirePhoneVerify` (Settings → Order protection, default ON
for new tenants). Codes: 6 digits, SHA-256 at rest, 10-minute TTL, 5-attempt
lock, per-order binding, 60s resend cooldown, 3 sends / 10 min / phone.

## Transactional email (password reset)

| Variable | Req | Scope | Notes |
|---|---|---|---|
| `EMAIL_PROVIDER` | no | server | `log` (default, console only) \| `smtp` \| `resend`. Set `smtp` or `resend` in production. |
| `EMAIL_FROM` | for smtp/resend | server | Verified sender address (e.g. `no-reply@…`). Required to enable a real provider. |
| `SMTP_HOST` | for smtp | server | SMTP relay host. |
| `SMTP_PORT` | no | server | Default `587`. |
| `SMTP_SECURE` | no | server | `true` = implicit TLS (465), `false` = STARTTLS (587). Default `false`. |
| `SMTP_USER` / `SMTP_PASS` | for smtp auth | server, secrets | Leave empty for no-auth relays. |
| `RESEND_API_KEY` | for resend | server, secret | Resend API key. |

A provider selected but incomplete silently falls back to the log driver
(dev-friendly); pick the provider + set `EMAIL_FROM` in production.
Reset tokens: SHA-256 at rest, 6-hour TTL, single-use, 5-attempt lock,
no account enumeration on the forgot endpoint (identical response).

At least one provider key is required in production when `LLM_PROVIDER`
is a network provider; otherwise the deterministic engine runs (warned).

## Fawry billing

| Variable | Req | Scope | Notes |
|---|---|---|---|
| `FAWRY_MERCHANT_CODE` | for billing | server, secret | Fawry merchant code. Absent = billing disabled, no payment links served. |
| `FAWRY_SECURE_KEY` | for billing | server, secret | Fawry signing key. Fail-closed: missing = all callback signatures rejected. |
| `FAWRY_SANDBOX` | no | server | `true` (default) = sandbox gateway, `false` = production. |

Plans: Starter 0 EGP, Growth 499 EGP/mo, Scale 1999 EGP/mo.
Checkout flow: Fawry hosted payment page (sandbox redirect works in dev).
Callback signature: SHA-256 hex of `merchantCode + merchantRefNumber + fawryRefNumber + amount + secureKey`, compared with timing-safe equals.
Idempotent: duplicate callback on an already-ACTIVE subscription is silently ignored.
Renewals (`POST /api/cron/renew-subscriptions`, daily): expired subs move to PAST_DUE and the owner is emailed a fresh checkout link — there is no server-side card charging.
Trial: once-ever 14-day trial attached on first checkout with a phone number (re-initiating checkout never extends it).

## Embeddings / infra / channels

| Variable | Req | Scope | Notes |
|---|---|---|---|
| `EMBEDDING_PROVIDER` | no | server | `local` (default, zero-cost) \| `openai`. |
| `OPENAI_API_KEY_FOR_EMBEDDINGS` | if openai emb. | server, secret | Falls back to `LLM_API_KEY`. |
| `REDIS_URL` | prod: yes | server | Absent = in-process queue (**dev/single-instance only**, boot warns in prod). |
| `WHATSAPP_VERIFY_TOKEN` | if WA | server, secret-ish | Webhook verification string. |
| `WHATSAPP_APP_SECRET` | if WA | server, secret | HMAC-SHA256 signature check. |
| `WHATSAPP_PHONE_NUMBER_ID` | if WA | server | Sending identity. |
| `WHATSAPP_ACCESS_TOKEN` | if WA | server, secret | Bearer for Graph API sends. |
| `WHATSAPP_API_VERSION` | no | server | Default `v21.0`. |
| `INSTAGRAM_VERIFY_TOKEN` | if IG | server, secret-ish | Webhook verification string. |
| `INSTAGRAM_APP_SECRET` | if IG | server, secret | HMAC-SHA256 signature check. |
| `INSTAGRAM_USER_ID` | if IG | server | Instagram Business account ID. |
| `INSTAGRAM_ACCESS_TOKEN` | if IG | server, secret | Bearer for Graph API sends. |
| `INSTAGRAM_API_VERSION` | no | server | Default `v21.0`. |
| `MESSENGER_VERIFY_TOKEN` | if MSGR | server, secret-ish | Webhook verification string. |
| `MESSENGER_APP_SECRET` | if MSGR | server, secret | HMAC-SHA256 signature check. |
| `MESSENGER_PAGE_ID` | if MSGR | server | Facebook Page ID. |
| `MESSENGER_ACCESS_TOKEN` | if MSGR | server, secret | Bearer for Graph API sends. |
| `MESSENGER_API_VERSION` | no | server | Default `v21.0`. |
| `N8N_ORDER_WEBHOOK_URL` / `N8N_GENERIC_WEBHOOK_URL` | no | server | Optional fan-out; core works without. |
| `CRON_SECRET` | for cron | server, secret | Shared secret (`x-cron-secret` header) for `POST /api/cron/cart-nudge` (every ~15 min) and `POST /api/cron/renew-subscriptions` (daily). Unset = endpoints 403. |
| `WORKER_ONLY` | prod compose | server | `1` = web stays HTTP-only, the dedicated worker drains the queue (shared `.env`, compose sets it). Unset = web embeds the consumer (dev/single-instance). |
| `BOSTA_API_KEY` | for courier | server, secret | Bosta API key (sandbox by default). Empty = no courier integration. |
| `BOSTA_WEBHOOK_SECRET` | for courier | server, secret | HMAC secret for Bosta tracking webhooks. |
| `BOSTA_SANDBOX` | for courier | server | `true` (default) = sandbox, `false` = production. |
| `STORAGE_PROVIDER` | no | server | `local` (default, `STORAGE_DIR` volume) \| `s3` (S3-compatible, e.g. Cloudflare R2). Unknown value = boot error. |
| `S3_ENDPOINT` | for s3 | server | e.g. `https://<accountid>.r2.cloudflarestorage.com`. |
| `S3_REGION` | for s3 | server | Default `auto` (correct for R2). Used in SigV4 scope. |
| `S3_BUCKET` | for s3 | server | Bucket name. Objects live at `<bucket>/<tenantId>/<uuid>.<ext>`. |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | for s3 | server, secrets | Missing any of endpoint/bucket/keys = warn + local fallback (error in prod boot check). |
| `S3_PUBLIC_BASE_URL` | for s3 | server | Public base serving the bucket, e.g. `https://pub-xxx.r2.dev`. Without it, stored URLs point at the API endpoint (not publicly readable). |
| `STORAGE_DIR` | no | server | Local driver root (default `./storage`). Mount a persistent volume in production. |
| `BACKUP_DIR` | no | server | `scripts/backup.sh` output dir (default `./backups`). |
| `BACKUP_RETENTION_DAYS` | no | server | `scripts/backup.sh` pruning window (default `30`). |
| `SENTRY_DSN` | no | server, secret-ish | Optional `https://key@host/projectid` — server errors are forwarded as Sentry envelopes (fire-and-forget, 10s timeout). Empty = logs only. The key is Sentry-public by design, but keep it server-side anyway. |
| `SENTRY_ENVIRONMENT` | no | server | Event environment tag (default `NODE_ENV`). |
| `SHIPPING_PICKUP_*` | for courier | server | Pickup address: FIRST_NAME, LAST_NAME, PHONE, EMAIL, ADDRESS_LINE1, CITY, STATE, POSTAL_CODE. |
| `RATE_LIMIT_*` | no | server | Window/maxima; in-process (see multi-instance warning in `docs/DEPLOYMENT.md`). |

## Rotation cheat-sheet

All secrets are env-only: rotate in the provider dashboard + redeploy env,
no code change. `JWT_SECRET` rotation logs everyone out (by design).
