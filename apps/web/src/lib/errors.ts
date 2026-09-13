import { fail } from "./api";

/** Safe application error: internal detail stays in logs, clients get codes. */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const AppErrors = {
  notFound: (what = "Resource") => new AppError("NOT_FOUND", `${what} not found`, 404),
  invalidState: (msg: string) => new AppError("INVALID_STATE", msg, 409),
  insufficientStock: (msg: string) => new AppError("INSUFFICIENT_STOCK", msg, 409),
  unavailable: (msg: string) => new AppError("UNAVAILABLE", msg, 422),
  forbidden: (msg = "Insufficient permissions") => new AppError("FORBIDDEN", msg, 403),
  rateLimited: (msg = "Too many requests") => new AppError("RATE_LIMITED", msg, 429),
  badRequest: (msg: string, details?: unknown) => new AppError("BAD_REQUEST", msg, 400, details),
};

/** Convert any thrown error into a safe API response (no stacks/SQL/prompts). */
export function toApiError(err: unknown, requestId: string) {
  if (err instanceof AppError) {
    return fail(err.code, err.message, { status: err.status, details: err.details, requestId });
  }
  const msg = err instanceof Error ? err.message : "Unknown error";
  // Known internal state codes stay machine-readable but carry no internals.
  if (/^(ORDER_NOT_FOUND|VARIANT_NOT_FOUND|TENANT_NOT_FOUND)/.test(msg)) {
    return fail("NOT_FOUND", "Resource not found", { status: 404, requestId });
  }
  if (/^(INVALID_STATE|INSUFFICIENT_STOCK)/.test(msg)) {
    return fail(msg.split(":")[0], "Request conflicts with current state", { status: 409, requestId });
  }
  return fail("INTERNAL", "Something went wrong", { status: 500, requestId });
}
