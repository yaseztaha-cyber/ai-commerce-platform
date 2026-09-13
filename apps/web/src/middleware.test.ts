import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { buildCsp, middleware } from "./middleware";

function post(path: string, ip: string): NextRequest {
  return new NextRequest(`http://local${path}`, {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

function postWith(path: string, headers: Record<string, string>): NextRequest {
  return new NextRequest(`http://local${path}`, { method: "POST", headers });
}

describe("middleware abuse guard", () => {
  it("allows GETs and exempt mutating endpoints", async () => {
    const get = await middleware(new NextRequest("http://local/api/orders"));
    expect(get.status).not.toBe(429);
    const login = post("/api/auth/login", "10.9.0.1");
    expect((await middleware(login)).status).not.toBe(429);
    const wa = post("/api/channels/whatsapp?tenant=x", "10.9.0.2");
    expect((await middleware(wa)).status).not.toBe(429);
  });

  it("throttles mutating API bursts at 120/min per IP", async () => {
    const ip = `10.8.0.${Date.now() % 250}`;
    let last = 200;
    for (let i = 0; i < 125; i++) {
      const res = await middleware(post("/api/products", ip));
      last = res.status;
    }
    expect(last).toBe(429);
    const body = await (await middleware(post("/api/products", ip))).json();
    expect(body).toMatchObject({ ok: false, error: { code: "RATE_LIMITED" } });
  });
});

describe("middleware origin guard", () => {
  it("blocks cross-origin mutations with a forged Origin", async () => {
    const res = await middleware(postWith("/api/products", { host: "local", origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, error: { code: "ORIGIN_BLOCKED" } });
  });

  it("allows same-origin mutations", async () => {
    const res = await middleware(postWith("/api/products", { host: "local", origin: "http://local" }));
    expect([200, 429]).toContain(res.status);
  });

  it("ignores absent and null origins (server-to-server / sandboxed clients)", async () => {
    const none = await middleware(postWith("/api/products", { host: "local" }));
    expect(none.status).not.toBe(403);
    const nul = await middleware(postWith("/api/products", { host: "local", origin: "null" }));
    expect(nul.status).not.toBe(403);
  });

  it("lets cross-origin webhooks through (channels, billing, shipping)", async () => {
    const metaOrigin = { origin: "https://graph.facebook.com" };
    for (const p of ["/api/channels/instagram?tenant=x", "/api/channels/messenger?tenant=x", "/api/billing/callback", "/api/shipping/webhook"]) {
      const res = await middleware(postWith(p, metaOrigin));
      expect(res.status).not.toBe(403);
      expect(res.status).not.toBe(429);
    }
  });
});

describe("middleware CSP nonce", () => {
  it("attaches a per-request nonce CSP to pages, API passes, and 429s", async () => {
    const page = await middleware(new NextRequest("http://local/dashboard"));
    const csp = page.headers.get("Content-Security-Policy") ?? "";
    const nonce = page.headers.get("x-nonce") ?? "";
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(csp).toContain(`'nonce-${nonce}'`);
    const api = await middleware(post("/api/auth/login", "10.9.1.1"));
    expect(api.headers.get("Content-Security-Policy")).toContain("'nonce-");
    const ip = `10.7.0.${Date.now() % 250}`;
    let limited: Response | null = null;
    for (let i = 0; i < 125; i++) {
      const res = await middleware(post("/api/products", ip));
      if (res.status === 429) {
        limited = res as unknown as Response;
        break;
      }
    }
    expect(limited?.headers.get("Content-Security-Policy")).toContain("script-src");
  });

  it("keeps scripts strict (no unsafe-inline) with self-only connect", () => {
    const prod = buildCsp("abc123", false);
    const script = prod.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
    expect(script).not.toContain("unsafe-inline");
    expect(script).toContain("'self'");
    expect(prod).toContain("connect-src 'self'");
    expect(prod).toContain("frame-ancestors 'none'");
    expect(buildCsp("abc123", true)).toContain("'unsafe-eval'");
  });
});
