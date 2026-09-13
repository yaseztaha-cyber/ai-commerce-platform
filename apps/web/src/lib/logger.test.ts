import { describe, expect, it } from "vitest";
import { sanitize } from "./logger";

describe("logger sanitize", () => {
  it("redacts secret-keyed fields", () => {
    const out = sanitize({ password: "pw", apiKey: "ak", accessToken: "t", cvv: "123", status: 200 });
    expect(out.password).toBe("[redacted]");
    expect(out.apiKey).toBe("[redacted]");
    expect(out.accessToken).toBe("[redacted]");
    expect(out.cvv).toBe("[redacted]");
    expect(out.status).toBe(200);
  });

  it("scrubs card numbers that appear as values under non-secret keys", () => {
    const out = sanitize({
      body: "Charged card 4111111111111111 for order 5",
      raw: "4242 4242 4242 4242",
      short: "42",
    });
    expect(out.body).toBe("Charged card [redacted] for order 5");
    expect(out.raw).toBe("4242 4242 4242 4242");
    expect(out.short).toBe("42");
  });

  it("leaves identifiers and non-sensitive values alone", () => {
    const out = sanitize({ requestId: "req_abc", phone: "01000000001", status: 201 });
    expect(out.requestId).toBe("req_abc");
    expect(out.phone).toBe("01000000001");
    expect(out.status).toBe(201);
  });
});