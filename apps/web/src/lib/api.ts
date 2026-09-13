import { NextResponse } from "next/server";

export interface ApiErrorBody {
  ok: false;
  error: { code: string; message: string; details?: unknown };
  requestId: string;
}

export function ok<T>(data: T, init?: { status?: number; requestId?: string }) {
  return NextResponse.json(
    { ok: true, data, requestId: init?.requestId ?? "n/a" },
    { status: init?.status ?? 200 }
  );
}

export function fail(code: string, message: string, opts?: { status?: number; details?: unknown; requestId?: string }) {
  const body: ApiErrorBody = {
    ok: false,
    error: { code, message, details: opts?.details },
    requestId: opts?.requestId ?? "n/a",
  };
  return NextResponse.json(body, { status: opts?.status ?? 400 });
}

export const Errors = {
  unauthorized: (requestId: string) => fail("UNAUTHORIZED", "Not authenticated", { status: 401, requestId }),
  forbidden: (requestId: string) => fail("FORBIDDEN", "Insufficient permissions", { status: 403, requestId }),
  notFound: (requestId: string, what = "Resource") => fail("NOT_FOUND", `${what} not found`, { status: 404, requestId }),
  validation: (requestId: string, details?: unknown) => fail("VALIDATION", "Invalid request", { status: 422, details, requestId }),
  conflict: (requestId: string, message = "Conflict") => fail("CONFLICT", message, { status: 409, requestId }),
  rateLimited: (requestId: string) => fail("RATE_LIMITED", "Too many requests", { status: 429, requestId }),
  tooLarge: (requestId: string, maxKb: number) =>
    fail("PAYLOAD_TOO_LARGE", `Body exceeds ${maxKb}KB limit`, { status: 413, requestId }),
  internal: (requestId: string) => fail("INTERNAL", "Something went wrong", { status: 500, requestId }),
};

/** Reject oversized bodies BEFORE parsing (uploads are untrusted input). */
export function isBodyTooLarge(req: Request, maxBytes: number): boolean {
  const len = Number(req.headers.get("content-length") ?? "0");
  return Number.isFinite(len) && len > maxBytes;
}
