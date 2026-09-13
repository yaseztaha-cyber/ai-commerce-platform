# Fix plan: the 8 owner-side leaks

**Status 2026-09-11: All 8 leaks (1A, 1B, 2A, 2B, 3, 4, 5, 6, 7, 8) are SHIPPED and verified.**

## SHIPPED — Leak 1B: voice transcription (2026-09-06)
- `TranscriptionProvider` (Whisper-compatible `/audio/transcriptions`,
  model/endpoint/key all env-driven) + two-step Graph media download with
  byte caps enforced before/during buffering and an audio allowlist.
- New `transcribe_message` queue job (in the Redis consumer rotation):
  claim → download → transcribe → normal agent turn → send → PROCESSED.
  Failure contract: timeout → bounded retry; deterministic failures
  (auth/size/format/down) → 1A fallback + PROCESSED; agent-phase failure →
  generic fallback + escalate + bounded retry. Nothing loops forever,
  nothing is silent.
- Routing gate: WhatsApp audio + mediaId + key + WA token, else instant
  fallback (SIMULATOR/dev always falls back — no fake transcripts).
- Metered as `transcription` usage, shown on the analytics plan card.
- Verified: unit (routing/parsing/timeout/oversize/auth), integration
  (full job → answered turn + PROCESSED + metered; failure → fallback;
  timeout → claim released for retry).

## SHIPPED — Leak 1A: voice/photo silence → instant acknowledgment

- `NormalizedInbound.kind: text | media` (+`mediaType`); WhatsApp normalize
  emits audio/image/video/document/sticker as media (unknown types ignored).
- Inbox stores a readable marker (🎤 voice message, 🖼️ photo, …).
- `processMessageJob` short-circuits media: deterministic Arabic fallback,
  **zero tool calls, zero LLM cost**, normal send/delivery tracking.
- Verified: signed webhook → 401 on forgery → thread shows
  `[customer] 🎤 voice message | [assistant] وصلني الفويس…`; integration test
  asserts 0 tool calls + 0 AI runs for media.
- Transcription (1B) still open: see plan below.

## SHIPPED — Leak 2A: outbound product photos

- `OutboundMessage.image`, WhatsApp native `type: image` payloads with
  absolute links, `get_product` exposes `images`, order-review attaches the
  product's first photo, playground renders it.
- Verified live: review carried
  `/api/files/…png`; unit tests on normalize + payload builder.

## SHIPPED — Leak 2B: inbound sight (2026-09-06)

- `VisionProvider` (OpenAI-compatible chat with `image_url`, `detail: low`,
  model/endpoint/key env-driven) + strict JSON reading parse with a
  configurable confidence gate (default 0.7).
- New `sight_message` queue job (in the Redis consumer rotation): claim →
  download → classify → labeled reading stored as a customer message
  ("📷 وصف الصورة: …", so merchants see what the AI acted on) → normal
  agent turn on the reading → send → PROCESSED. Failure contract mirrors
  transcription: timeout → bounded retry; low-confidence/deterministic →
  1A fallback + PROCESSED; agent-phase → generic fallback + escalate.
- Routing gate (WhatsApp photo + mediaId + key + WA token) else instant
  fallback; per-conversation cap (default 5) bounds photo-dump cost;
  metered as `vision` usage with an analytics dashboard row.
- Hard rule kept: the reading is UNTRUSTED candidate text — stock, prices,
  and disambiguation still come from tools.
- Verified: unit (routing/parse/gate/network kinds), integration (full job
  → answered turn + PROCESSED + metered; low-confidence → fallback;
  timeout → claim released).

---

## SHIPPED — Leak 6: size intelligence (2026-09-06)

- `ProductMeasurement` table (per-product cm rows, unique per size) +
  dashboard editor + CSV `chest/length/shoulder/sleeve` columns.
- `recommend_size` tool ranks from real numbers only (chest+ease, else
  explicitly low-confidence estimate, else the table for follow-up);
  agent presents as suggestion + confirms, never asserts fit.
- `remember_customer_size` tool (explicit opt-in, self record, validated
  code) + auto-memory after 2 consistent confirmed orders (fire-and-forget,
  never overwrites explicit opt-in, never blocks confirmation).
- Known size surfaces in customer context ("same as last time?"); body
  metrics never leave the transcript; erasure clears `preferredSize`.
- Verified: ranking math, extractors (Arabic/English/Indic digits, advice
  vs selection), agent advice + opt-in turns, auto-memory, erasure.

## SHIPPED — Leak 7: fake-order protection (2026-09-06)

- `PhoneVerification` rows (SHA-256 hashes, 10-min TTL, 5-attempt lock,
  per-order binding) + `Tenant.requirePhoneVerify` (default ON).
- `VerificationProvider`: log (dev) / generic webhook / Twilio drivers.
- `confirmOrder` gate: no verified code for the order → `PHONE_NOT_VERIFIED`,
  no bypass. Agent: confirm → code sent → digits verified → confirmed;
  wrong/locked/expired handled with resend guidance or escalation.
- Guards: 60s resend cooldown, 3 sends / 10 min / phone, attempts counter.
- Metered as `verification` usage; dashboard toggle in Settings.
- Verified: 10 service tests + 3 agent flow tests + live walk
  (draft → code → wrong → right → #CONFIRMED).

---

Ordered by money impact. Each leak ships independently behind existing
patterns (tools own truth, backend owns actions, tenant isolation everywhere).
No step rewrites working modules.

---

## Leak 1 — Voice notes get total silence
**Impact:** lost customers who think they're ignored.

- **1A — instant fallback (small, ship first).** `whatsapp.normalize` currently
  drops non-text silently. Change: emit a `media` inbound kind for
  audio/image (`m.type`, no transcript), and have the agent reply
  "وصـلني فويس/صورة — ابعتلي كتابة لو سمحت 🙏" without calling product tools.
  Files: `server/messaging/whatsapp.ts`, `server/ai/agent.ts` (media branch),
  `server/messaging/types.ts` (`NormalizedInbound.kind: text|media`).
  Tests: normalize unit (audio → media kind), agent test (media → fallback
  text, zero tool calls, no draft).
- **1B — transcription (real fix).** New `TranscriptionProvider` abstraction
  (`server/ai/transcribe.ts`): Whisper-compatible endpoint via env
  (`TRANSCRIBE_PROVIDER=openai-compatible`, `TRANSCRIBE_API_KEY`,
  `TRANSCRIBE_MODEL=whisper-1`), media download via Graph API (`GET
  /{media-id}` → file bytes, 25MB cap, audio MIME allowlist), timeout 30s,
  failure → 1A fallback (never a crash, never a hallucinated transcript).
  Queue job `transcribe_message` so webhooks stay fast. Tenant pays per use —
  meter as `tool_call`.
  Tests: mocked endpoint (Arabic audio fixture → expected text), oversize
  rejection, provider-down → fallback. Acceptance: voice "عايز الاسود L"
  completes a real order end-to-end.

## Leak 2 — AI can't send or see photos
**Impact:** text-only selling in a visual market.

- **2A — outbound product images (small).** WhatsApp `send` gains
  `image?: {url, caption}` via Meta `type: image` messages; `sendReply` and
  the simulator/console log it. Agent rule: attach the product's first image
  to the order-review message (URL from `ProductImage`, tenant-scoped —
  never another tenant's file). Files: `whatsapp.ts`, `processor.ts`,
  `agent.ts` (review text + image), `messaging/types.ts`.
  Tests: review turn includes image URL of the right product; unit test on
  the send payload shape. Acceptance: playground/Web show the photo with
  the review (simulator logs the URL).
- **2B — inbound sight (bigger).** Vision-capable model call
  (`VisionProvider`, same OpenAI-compatible shape, `detail: low` to control
  cost) classifying a customer photo to catalog product + color ("matches
  Oversized Black, confidence .82"). Hard rule preserved: vision output is a
  *candidate*, stock/price still come from tools; below-threshold → ask for
  text + escalate path. Metered, capped per conversation.
  Tests: fixture photo → expected candidate; unrelated photo → clarification,
  no draft. Acceptance: "عايز ده 📷" resolves or gracefully clarifies.

## Leak 3 — No courier integration (manual copy-paste fulfillment)
**Impact:** every order costs 3–5 minutes of hand work; no tracking updates.
**SHIPPED 2026-09-11** — implemented as planned: `ShippingProvider` abstraction with Bosta driver (sandbox default), order detail "Book pickup" button, tracking webhook with HMAC verification mapping Bosta states to order transitions (READY → OUT_FOR_DELIVERY → COMPLETED/RETURNED), customer notifications via existing `notifyCustomer`. Verified: build passes, all tests green, live order flow creates tracking number and label URL.

## Leak 4 — Facebook/Instagram aren't real
**Impact:** misses where Egyptian clothing actually sells.
**SHIPPED 2026-09-11** — implemented as planned: `InstagramProvider` + `MessengerProvider` implementing `MessagingProvider` interface (Meta Graph API), webhook verify + `X-Hub-Signature-256` HMAC, text normalization, send-text + native image messages, idempotency via existing `(tenant, providerMessageId)`. Routes `/api/channels/instagram` and `/api/channels/messenger` with GET verification + POST handling. Dashboard shows webhook URLs + required env vars. Comment-to-DM deferred to phase 4B. Verified: build passes, all tests green, webhook flows match WhatsApp pattern.

## Leak 5 — No discounts, bundles, or abandoned-cart recovery
**Impact:** margin levers and ghosted carts left on the table.
**SHIPPED 2026-09-10** — implemented as planned, plus: percent capped at 90,
unknown kinds ignored (fail closed), draft snapshots win over later edits,
usage counted at confirm (best-effort), FAILED nudges retry until 3 strikes,
consent default flipped to opt-out (transactional reminders), cron route
behind CRON_SECRET. Verified: 5 engine unit groups + 10 integration (draft/
confirm/caps/isolation/validation/BXGY) + agent quote + review-discount +
cart sweep matrix (once-only/fresh/replied/opt-out/failed/cron-auth).

- **Promotions engine (backend-owned, AI only quotes tool results).**
  Schema: `Promotion(tenantId, name, kind: PERCENT|FIXED|BXGY|FREE_SHIPPING,
  value, minSubtotal, productIds?, startAt, endAt, active, usageLimit)`.
  `calculateTotals` gains an `applyPromotions(lines, subtotal)` step returning
  line-level discount breakdown; order items snapshot applied promos.
  Dashboard CRUD + `get_promotions` agent tool (read-only). Hard rule kept:
  model can never invent a discount — totals only move via engine output.
  Tests: percent/floor-at-zero/expiry/product-scope/stacking-order unit
  tests + API validation tests.
- **Abandoned carts.** `DRAFT`/`PENDING_CONFIRMATION` untouched 2h (per-tenant
  `cartNudgeHours`, marketing consent respected) → one WhatsApp nudge with
  cart summary; never more than one nudge per draft; any reply cancels the
  timer. New `cart-nudge` worker tick (daily) + `Notification` record.
  Tests: stale draft → exactly one nudge; replied draft → none; consent-off
  → none. Acceptance: ghosted cart produces one polite Arabic reminder.

## Leak 6 — No size intelligence
**Impact:** wrong size = return = double shipping.

- **Measurements table.** `ProductMeasurement(productId, size, chest, length,
  shoulder, sleeve)` + dashboard editor + CSV columns. Shown in a "Size guide"
  collapsible; RAG keeps prose guides, numbers live in the DB.
- **`recommend_size` tool.** Inputs (height/weight/fit preference, optional),
  outputs ranked sizes with reasons from the table — advisory only, always
  ends asking the customer to confirm. No body-data stored beyond the
  conversation (privacy note in PRIVACY.md).
- **Remember buyer size.** Opt-in long-term memory: after a *confirmed* order,
  store `preferredSize` per customer **only when explicitly established**
  ("مقاسي L دايماً" or 2+ consistent orders); surfaced as "last time L —
  same?" Never inferred from one message, erasable via existing erasure
  endpoint, excluded from analytics.
  Tests: recommender unit table, opt-in persistence rules, erasure clears it.
  Acceptance: returning buyer hears "زي المرة اللي فاتت L؟".

## Leak 7 — No fake-order protection (COD prank tax)
**Impact:** every fake number costs a shipping fee.
**SHIPPED 2026-09-06** — implemented as planned, plus: resend cooldown (60s),
per-phone send cap (3/10min), order→PENDING_CONFIRMATION on send, resend-on-
reconfirm after lock/expiry, `verification` usage metering. Verified: 10
service tests + 3 agent flow tests (send→wrong→right→confirmed, expired→
escalate) + live walk below. Toggle-off and phone-less drafts behave exactly
as before (gate requires a phone to verify against).

- **Phone OTP at confirmation.** New `VerificationProvider`
  (`server/verify/`, Twilio Verify or local SMS gateway via env) +
  `PhoneVerification(phone, code-hash, expiresAt 10min, attempts≤5)`.
  Flow: order review → "بعتلك كود على موبايلك" → correct code confirms,
  wrong×5 or expired → escalate, never confirm. Per-tenant toggle
  (`requirePhoneVerify`), default ON for new tenants (COD market reality),
  costs metered. Rate-limited sends; codes are hashed at rest.
  Tests: happy path, expiry, attempt-cap lockout, replay of used code fails,
  toggle-off path unchanged. Acceptance: full order completes only after a
  correct code; abuse probes (100 guesses) change nothing.

## Leak 8 — Onboarding is a weekend of labor
**Impact:** 300 SKUs by hand kills adoption.
**SHIPPED 2026-09-11** — implemented as planned: 3-step Quick-Add Wizard (basics → variants → photos), Bulk Variant Generator (color × size matrix with auto-SKUs + collision checking), CSV v2 Import (column mapping preview, per-row error UX, photo URL validation, all-or-nothing transaction). Dashboard links added to onboarding checklist. Verified: build passes, all tests green, 3 colors × 4 sizes matrix generates in under 2 minutes.

---

## Cross-cutting rules for all eight

- Secrets in env only, never logged (extend the client-boundary + log scans).
- Every new endpoint: RBAC check + tenant scope + rate limit + zod; every new
  table: tenant FK + needed indexes in the same migration.
- Regression suite must stay green; each leak adds its tests before its UI.
- Docs updated per leak (ENVIRONMENT for new vars, PRIVACY for size/phone
  data, WHATSAPP-equivalent page per new channel).
