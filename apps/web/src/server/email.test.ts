import { describe, expect, it } from "vitest";
import { emailDriver, passwordResetUrl } from "./email";

describe("email driver selection", () => {
  it("defaults to the log driver when no provider is configured", () => {
    expect(emailDriver().name).toBe("log");
  });

  it("builds absolute password-reset URLs from the public app url", () => {
    expect(passwordResetUrl("tok_abc")).toBe("http://localhost:3000/reset-password?token=tok_abc");
  });
});