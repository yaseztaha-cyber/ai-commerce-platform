import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Static client/server boundary: no `use client` file may reference
 * server-only secrets or ambient server env. NEXT_PUBLIC_APP_URL is the
 * single sanctioned public variable.
 */
const SECRET_TOKENS = [
  "OPENROUTER_API_KEY",
  "OPENCODE_API_KEY",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_PHONE_NUMBER_ID",
  "INSTAGRAM_ACCESS_TOKEN",
  "INSTAGRAM_APP_SECRET",
  "INSTAGRAM_USER_ID",
  "MESSENGER_ACCESS_TOKEN",
  "MESSENGER_APP_SECRET",
  "MESSENGER_PAGE_ID",
  "JWT_SECRET",
  "DATABASE_URL",
  "LLM_API_KEY",
  "SENTRY_DSN",
];

function clientFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "api") out.push(...clientFiles(full));
    } else if (/\.(tsx?|jsx?)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      const src = fs.readFileSync(full, "utf8");
      if (src.includes('"use client"') || src.includes("'use client'")) out.push(full);
    }
  }
  return out;
}

describe("client/server secret boundary", () => {
  it("no client component references server secrets", () => {
    const here = import.meta.dirname as string;
    const roots = [path.join(here, "components"), path.join(here, "app")];
    const files = roots.flatMap((r) => (fs.existsSync(r) ? clientFiles(r) : []));
    expect(files.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      for (const tok of SECRET_TOKENS) {
        if (src.includes(tok)) violations.push(`${path.basename(f)} contains ${tok}`);
      }
      const envUses = [...src.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]);
      for (const v of envUses) {
        if (v !== "NEXT_PUBLIC_APP_URL" && v !== "SESSION_COOKIE_NAME" && v !== "NODE_ENV") {
          violations.push(`${path.basename(f)} reads process.env.${v}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
