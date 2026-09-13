import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Edge middleware: per-request CSP nonce + central abuse guard for
 * mutating API calls + same-origin check (CSRF defense-in-depth behind the
 * SameSite=Strict session cookie). Endpoints with their own stricter budgets
 * (auth, webhooks, webchat, playground, invite accept) and cross-origin
 * webhooks (Meta, Bosta, Fawry) are exempt from the edge throttle AND the
 * origin check — the latter literally cannot be same-origin for third parties.
 * NOTE: in-process fixed window — multi-instance needs a shared limiter
 * or gateway/WAF (see docs/DEPLOYMENT.md).
 */
const EXEMPT_PREFIXES = [
  "/api/auth/",
  "/api/channels/whatsapp",
  "/api/channels/instagram",
  "/api/channels/messenger",
  "/api/billing/callback",
  "/api/shipping/webhook",
  "/api/webchat/",
  "/api/ai/test",
  "/api/team/accept",
  "/api/health",
  "/api/ready",
];

const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX = 120;
const WINDOW_MS = 60_000;

/**
 * Strict-ish CSP with a per-request nonce. scripts: self + nonce only
 * (dev adds unsafe-eval for Next fast-refresh). styles: self + nonce +
 * unsafe-inline — React style props and Tailwind compile to inline styles,
 * so style elements/attributes stay allowed while scripts stay strict.
 * connect: self only (LLM/Meta/Fawry calls are all server-side).
 * img/media: self + https/data/blob (local files, R2 public URLs, Meta CDN).
 */
export function buildCsp(nonce: string, isDev: boolean): string {
  const script = ["'self'", `'nonce-${nonce}'`];
  if (isDev) script.push("'unsafe-eval'");
  return [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    `style-src 'self' 'nonce-${nonce}' 'unsafe-inline'`,
    "img-src 'self' data: blob: https:",
    "media-src 'self' https: blob:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function middleware(req: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = buildCsp(nonce, process.env.NODE_ENV !== "production");
  const forwarded = new Headers(req.headers);
  forwarded.set("x-nonce", nonce);
  forwarded.set("Content-Security-Policy", csp);

  const pass = () => {
    const res = NextResponse.next({ request: { headers: forwarded } });
    res.headers.set("Content-Security-Policy", csp);
    res.headers.set("x-nonce", nonce);
    return res;
  };
  const deny = (status: number, code: string, message: string) => {
    const res = NextResponse.json(
      { ok: false, error: { code, message }, requestId: "n/a" },
      { status }
    );
    res.headers.set("Content-Security-Policy", csp);
    res.headers.set("x-nonce", nonce);
    return res;
  };

  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return pass();
  const path = req.nextUrl.pathname;
  if (EXEMPT_PREFIXES.some((p) => path.startsWith(p))) return pass();

  // Same-origin check: browsers attach Origin to all POST/PUT/PATCH/DELETE.
  // Server-to-server clients (curl, fetch from Node) send none — pass through.
  // An attacker's page cannot forge this for cookie-authed routes (SameSite
  // blocks the cookie anyway); this is defense-in-depth (e.g. if a deployment
  // ever relaxes SameSite). "null" origins (sandboxed/webview clients) skip.
  const origin = req.headers.get("origin");
  if (origin && origin !== "null") {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      originHost = null;
    }
    const host = req.headers.get("host")?.toLowerCase();
    if (!originHost || !host || originHost !== host) {
      return deny(403, "ORIGIN_BLOCKED", "Cross-origin request blocked");
    }
  }

  const ip =
    req.headers.get("x-forwarded-proto") && req.headers.get("x-forwarded-for")
      ? req.headers.get("x-forwarded-for")!.split(",")[0]!.trim()
      : req.headers.get("x-real-ip") || "local";
  const key = `mw:${ip}`;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return pass();
  }
  if (b.count >= MAX) return deny(429, "RATE_LIMITED", "Too many requests");
  b.count += 1;
  return pass();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"] };
