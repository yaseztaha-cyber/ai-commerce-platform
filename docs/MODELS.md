# Models & Providers (OpenRouter + OpenCode)

The LLM is **language understanding + tool selection only**. The backend owns
stock, prices, orders, and permissions regardless of which model answers —
a weak or misbehaving free model can at worst produce a poor sentence, never
an illegal business action (all actions go through validated, tenant-scoped
tools; replies are composed from verified tool results).

## Gateways (both OpenAI-compatible `POST {base}/chat/completions`)

| Gateway | Base URL | Key env | Notes |
|---|---|---|---|
| OpenRouter | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` | Bearer auth + `HTTP-Referer`/`X-Title` headers. OpenAI-style `tools`/`tool_calls`, `usage` tokens. |
| OpenCode Zen | `https://opencode.ai/zen/v1` | `OPENCODE_API_KEY` | Bearer auth, OpenAI-compatible (`/chat/completions`). Free `-free` model IDs available. |

Keys are read **server-side only** (`src/lib/env.ts`, used by
`src/server/ai/providers.ts`). They never enter client components,
`NEXT_PUBLIC_*` vars, logs, or error messages. `.env.example` carries
placeholders only.

## Fallback chain (no infinite loops)

```
OpenRouter primary model (LLM_MODEL)
  ↓ retryable error (timeout/429/5xx/network/malformed), ≤ LLM_MAX_RETRIES same-provider retries
OpenRouter fallback model (LLM_FALLBACK_MODEL)
  ↓ failure
OpenCode Zen model (OPENCODE_MODEL)
  ↓ failure
throw → agent replies safely in Arabic + escalates to human + logs internally
```

Client errors (401/403/404/400) skip same-provider retries but still allow
**one** attempt at the next candidate (different key/backend may succeed).
Every attempt has `LLM_TIMEOUT_MS`; 429 honors `Retry-After` (≤10s).
Total worst case ≈ candidates × (1 + retries) requests, then stop.

## Task routing

`LLM_MODEL_AGENT/SIMPLE/EXTRACT/COMPLEX/RAG` override the primary per task;
empty = use `LLM_MODEL`:

- simple replies → cheap model (`LLM_MODEL_SIMPLE`)
- product extraction → structured-output model (`LLM_MODEL_EXTRACT`)
- complex questions → stronger model (`LLM_MODEL_COMPLEX`)
- RAG answers → answer model (`LLM_MODEL_RAG`)
- agent turns → `LLM_MODEL_AGENT` (default: primary)

## Choosing free models (catalog changes — verify, don't assume)

Free-model availability rotates frequently (models observed one month are
gone the next), so IDs live in env, not code. Verified 2026-09-05 via the
public catalog (no key needed):

```bash
curl "https://openrouter.ai/api/v1/models?supported_parameters=tools&max_price=0&limit=100"
```

Tool-capable `:free` models seen then included `z-ai/glm-5.2:free`,
`google/gemma-4-31b-it:free`, `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`,
`poolside/laguna-s-2.1:free`, `cohere/north-mini-code:free`,
`minimax/minimax-m3:free`. Current defaults:

```env
LLM_MODEL="z-ai/glm-5.2:free"              # strong tool calling + multilingual, 1M ctx
LLM_FALLBACK_MODEL="google/gemma-4-31b-it:free"  # multilingual instruction, 262K ctx
OPENCODE_MODEL="deepseek-v4-flash-free"    # fast tool-capable fallback on Zen
```

Selection criteria: structured tool-call reliability first, then Arabic/
multilingual ability, latency, and context window — not benchmark size.
Re-check the catalog when changing models; prefer entries whose
`supported_parameters` include `tools` and with a healthy
`min_tool_success_rate`. Avoid `openrouter/free` (random router) for
production — repeatability matters more than convenience.

## Live verification without secrets in repo

Providers are unit-tested with mocked transport (`providers.test.ts`).
For a real wire check without committing keys, point a gateway at a local
stub and call `generate()` directly (see final report for the exact
procedure) — this exercises URL/auth-header/body/parsing over real HTTP.
A production live call is an operator step: export the keys in your own
shell, set `LLM_PROVIDER=composite`, restart, and use the AI playground.
