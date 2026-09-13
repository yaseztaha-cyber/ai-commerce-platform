import { z } from "zod";
import { Errors, fail, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { config } from "@/lib/env";
import { ensureInit } from "@/server/init";
import { applyPasswordResetToken } from "@/server/account-recovery";

const schema = z.object({
  token: z.string().min(1).max(512),
  password: z.string().min(8).max(128),
});

export async function POST(req: Request) {
  ensureInit();
  const requestId = newRequestId();
  const rl = rateLimit(`auth:${clientKey(req)}`, config.rateLimit.maxAuth, config.rateLimit.windowMs);
  if (!rl.allowed) return Errors.rateLimited(requestId);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Errors.validation(requestId, parsed.error.flatten());

  const result = await applyPasswordResetToken(parsed.data.token, parsed.data.password);
  if (!result.ok) {
    return fail("INVALID_RESET_TOKEN", "Reset link is invalid or has expired. Request a new one.", { status: 400, requestId });
  }
  return ok({ reset: true }, { requestId });
}