import { describe, expect, it, afterEach } from "vitest";
import { cronAuthReason, verifyCronSecret } from "./cron";

const PREV = process.env.CRON_SECRET;

afterEach(() => {
  if (PREV === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = PREV;
});

function reqWith(secret: string | null): Request {
  const headers = new Headers();
  if (secret !== null) headers.set("x-cron-secret", secret);
  return new Request("http://localhost:3000/api/cron/cart-nudge", { method: "POST", headers });
}

describe("cron shared-secret guard", () => {
  it("accepts the exact secret, rejects wrong and missing", () => {
    process.env.CRON_SECRET = "s3cr3t-shared-value-32chars-min!!";
    expect(verifyCronSecret("s3cr3t-shared-value-32chars-min!!", process.env.CRON_SECRET)).toBe(true);
    expect(verifyCronSecret("wrong", process.env.CRON_SECRET)).toBe(false);
    expect(verifyCronSecret("", process.env.CRON_SECRET)).toBe(false);
  });

  it("fail-closes when no secret is configured", () => {
    delete process.env.CRON_SECRET;
    expect(verifyCronSecret("anything")).toBe(false);
    expect(cronAuthReason(reqWith("anything"))).toBe("missing");
  });

  it("distinguishes missing config from bad credentials", () => {
    process.env.CRON_SECRET = "s3cr3t-shared-value-32chars-min!!";
    expect(cronAuthReason(reqWith("s3cr3t-shared-value-32chars-min!!"))).toBe("ok");
    expect(cronAuthReason(reqWith("nope"))).toBe("invalid");
    expect(cronAuthReason(reqWith(null))).toBe("invalid");
  });
});
