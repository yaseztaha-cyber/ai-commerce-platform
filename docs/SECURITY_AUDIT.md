# Security audit — 2026-09-06 (executed, not a checklist review)

Scope: all 37 API routes, service-layer tenant scoping, authN/Z, secrets,
webhooks, uploads, queue, dependencies, Prisma schema (indexes/constraints).
Method: read every route handler, grepped dangerous patterns
(`eval`/`innerHTML`/`dangerouslySetInnerHTML`/`queryRaw` — only two literal
`SELECT 1` hits), ran `npm audit`, wrote failing-first regression tests,
reproduced the order-number race, verified fixes live.

## Hardening round — 2026-09-12 (added on top of the matrix below)

- **CSRF defense-in-depth**: edge `middleware.ts` now rejects any mutating
  `/api/*` request whose `Origin` is present and not same-origin (403
  `ORIGIN_BLOCKED`). Browsers attach Origin to all POST/PUT/PATCH/DELETE;
  app cookies are `SameSite=Strict`, so this is a second belt for any
  deployment that relaxes SameSite. Server-to-server clients (no Origin),
  `null` origins (sandboxed/webview), and the public cross-origin webhooks
  (Meta channels, billing callback, shipping/webhook) pass. Regression tests
  added in `middleware.test.ts`.
- **Session cookies tightened** from `SameSite=Lax` to `SameSite=Strict`.
  Safety check: every cross-site entry point we rely on (invite accept,
  billing callback, channel webhooks, reset links) uses signed tokens or
  server-to-server calls — none depends on a session cookie surviving a
  cross-site navigation.
- **Webhook prefixes completed**: `channels/instagram`, `channels/messenger`,
  `billing/callback`, `shipping/webhook` were missing from the edge-exempt
  list, so third-party webhook bursts could hit the 120/min edge limiter.
  Now exempt (they keep their own in-route buckets, e.g. 300/min Meta).
- **Headers**: `poweredByHeader: false` (drop `X-Powered-By`),
  `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Resource-Policy: same-origin` globally; `/api/files/*`
  overrides CORP to `cross-origin` so merchants can embed product images.
- **Logger redaction widened**: added `/key/i` key matcher (apiKey/accessKey/
  privateKey) and value-scrubbing of 13–19-digit card-PAN patterns under any
  key. Covered by `lib/logger.test.ts`.

## Auth matrix (verified by reading each handler)

| Area | Verdict |
|---|---|
| Reads (`GET` lists/details) | session + tenant-scoped queries everywhere |
| Mutations | `requireRole` with fresh DB role on every route: MANAGER (catalog/inventory/knowledge/variants/images/customers-delete), ADMIN (settings/team/ai-test), AGENT (order status, inbox reply, customer notes) |
| Platform admin | `GET /api/admin/tenants` re-reads `isPlatformAdmin` from DB (**fixed**: was token-cached up to 7 days) |
| Public surface (intentional) | health/ready, files (unguessable URLs), WhatsApp webhook (HMAC), webchat (flood-limited), team/accept (token + rate-limited), auth/* (rate-limited) |
| Login | generic "Invalid email or password" (no enumeration); bcrypt compare |
| Passwords | min 8, bcrypt cost **12** (raised from 10); old hashes still verify |
| Sessions | HS256 pinned, exp enforced, httpOnly + **SameSite=Strict** + Secure-on-https; logout clears |

## Findings fixed this audit

1. **[MED] Order-number race (concurrency).** `createOrderDraft` did
   read-max-then-insert → parallel drafts collided on `(tenantId, number)`
   (reproduced by running two DB suites concurrently). Fix: atomic
   `Tenant.orderSeq` increment inside the draft transaction. Regression test:
   10 parallel drafts → 10 unique numbers.
2. **[MED] Transitive postcss RCE/file-read advisories** (via next 14.2.13's
   pinned 8.4.31). Fix: root `overrides: postcss ^8.5.28`, verified all copies
   8.5.28. (Build-time attack surface; app never compiles user CSS.)
3. **[MED] No security headers.** Fix: `nosniff`, `X-Frame-Options: DENY`,
   strict `Referrer-Policy`, minimal `Permissions-Policy` in `next.config.mjs`,
   plus a per-request nonce CSP in `middleware.ts` (strict `script-src`,
   `connect-src 'self'` since all provider calls are server-side; `style-src`
   keeps `unsafe-inline` for React/Tailwind inline styles). No HSTS (proxy's
   job — see DEPLOYMENT).
4. **[MED] Platform-admin flag trusted from JWT for 7 days.** Fix: fresh DB
   read on the admin route.
5. **[MED] Unsigned WhatsApp webhooks accepted.** `verifySignature` returns
   true with no secret (needed for dev). Fix: production POST returns 503
   without `WHATSAPP_APP_SECRET` + `WHATSAPP_UNSIGNED` boot check (error in
   prod, warn in dev). Verified by unit tests with injected secrets.
6. **[LOW] Authed mutation endpoints unthrottled.** Fix: edge `middleware.ts`
   — 120/min/IP for all mutating `/api/*` except endpoints with own buckets.
   Tested (121st bursts → 429 with safe envelope).
7. **[LOW] Missing customer-history indexes.** Fix: migration adds
   `Order(customerId)`, `Conversation(customerId)` (both driven by the
   customer detail page; verified in query plans by construction, not EXPLAIN).
8. **[LOW] bcrypt cost 10.** Raised to 12.

## Assessed, no change (with reason)

- **Next.js 14.2.13 critical advisories** (auth-bypass GHSA-7gfc,
  image-module GHSA-xv57): `next/image` is unused (plain `<img>` only), and
  auth lives in routes, not middleware — the bypass CVE degrades to
  rate-limit evasion at worst. Upgrade to Next 15/16 is breaking (async
  `cookies()` migration) — tracked as future work, not silent.
- **Login timing side-channel** (bcrypt only when user exists): accepted,
  rate-limited to 20/min/IP.
- **Register reveals email existence**: standard tradeoff, accepted.
- **Product search loads ≤200 rows for in-JS fuzzy match**: fine for SMB
  catalogs; documented scaling path (pg_trgm) in ARCHITECTURE. No blind index.
- **Console notification logs carry order/customer text**: stdout PII —
  accepted for ops visibility, flagged in log-retention docs. Never secrets
  (logger redacts password/secret/token keys; verified by scan + tests).
- **No product DELETE endpoint**: intentional — order history references
  variants with `Restrict`; deactivation is the safe path (UI supported).
- **RAG content untrusted by construction**: injection battery green
  (system-prompt reveal, customer dump, stock/price override all fail safe).

## Residual risks (see final report)

Free-model volatility, single-instance limiter/queue, 7-day session TTL with token-cached
(non-admin) roles. Backups ship as a script with operator-owned scheduling.
