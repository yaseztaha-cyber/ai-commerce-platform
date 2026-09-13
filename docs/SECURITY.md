# Security

- JWT sessions (HS256, `jose`) in httpOnly `SameSite=Lax` cookies; bcrypt passwords.
- RBAC on every route via `requireRole`; tenant scoping on every query.
- No raw SQL from model input; Prisma parameterized queries only; zod at boundaries.
- Uploaded docs treated as untrusted: never executed, never allowed to override policy.
- WhatsApp HMAC-SHA256 verification; `timingSafeEqual` comparison.
- Rate limits: auth (20/min), webhooks + API (300/min) per IP.
- Structured logs redact passwords/secrets/tokens/cards; no payment credentials stored.
- Secrets only via env (`.env.example` has placeholders; `.env` gitignored).
- Prompt-injection tests in `TESTING.md` must pass before release.
