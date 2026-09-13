import { describe, expect, it, afterEach } from "vitest";
import { captureError, parseSentryDsn, sentryEnvelopeUrl, SentryErrorTracker } from "./error-tracking";

describe("Sentry DSN parsing", () => {
  it("accepts https key@host/project shapes, rejects the rest", () => {
    expect(parseSentryDsn("https://abc123@o99.ingest.sentry.io/456")).toEqual({
      protocol: "https",
      host: "o99.ingest.sentry.io",
      projectId: "456",
      publicKey: "abc123",
    });
    expect(parseSentryDsn("")).toBeNull();
    expect(parseSentryDsn("not-a-dsn")).toBeNull();
    expect(parseSentryDsn("https://host-only/noid/extra/path")).toBeNull();
  });

  it("targets the project envelope endpoint (secret never in the URL)", () => {
    const dsn = parseSentryDsn("https://abc123@o99.ingest.sentry.io/456")!;
    expect(sentryEnvelopeUrl(dsn)).toBe("https://o99.ingest.sentry.io/api/456/envelope/");
  });
});

describe("Sentry capture (mocked fetch, no network)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("posts a well-formed envelope and redacts sensitive context", async () => {
    const seen: Array<{ url: string; body: string }> = [];
    globalThis.fetch = (async (url: unknown, init?: { body?: string }) => {
      seen.push({ url: String(url), body: String(init?.body ?? "") });
      return { ok: true } as Response;
    }) as typeof fetch;
    const dsn = parseSentryDsn("https://abc123@o99.ingest.sentry.io/456")!;
    await new SentryErrorTracker(dsn, "test").capture(new TypeError("boom"), {
      requestId: "req_1",
      secret: "should-hide",
      count: 3,
      nested: { deep: true },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://o99.ingest.sentry.io/api/456/envelope/");
    const lines = seen[0].body.split("\n");
    expect(lines).toHaveLength(3);
    const payload = JSON.parse(lines[2]) as { exception: { values: Array<{ type: string; value: string }> }; extra: Record<string, unknown>; environment: string };
    expect(payload.exception.values[0]).toMatchObject({ type: "TypeError", value: "boom" });
    expect(payload.environment).toBe("test");
    expect(payload.extra.requestId).toBe("req_1");
    expect(payload.extra.secret).toBe("[redacted]");
    expect(payload.extra.count).toBe(3);
    expect(payload.extra.nested).toBeUndefined();
  });

  it("never throws when the transport fails", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const dsn = parseSentryDsn("https://abc123@o99.ingest.sentry.io/456")!;
    await expect(new SentryErrorTracker(dsn, "test").capture(new Error("x"), {})).rejects.toThrow();
    await expect(captureError(new Error("x"), {})).resolves.toBeUndefined();
  });
});
