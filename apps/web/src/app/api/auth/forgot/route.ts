import { z } from "zod";
import { Errors, ok } from "@/lib/api";
import { newRequestId, logger } from "@/lib/logger";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { config } from "@/lib/env";
import { ensureInit } from "@/server/init";
import { createPasswordResetToken } from "@/server/account-recovery";
import { sendPasswordResetEmail } from "@/server/email";

const schema = z.object({ email: z.string().email().max(200) });

// Per-account flood guard in addition to the shared auth/IP budget.
const EMAIL_BUDGET = { max: 3, windowMs: 10 * 60 * 1000 };

export async function POST(req: Request) {
  ensureInit();
  const requestId = newRequestId();
  const rl = rateLimit(`auth:${clientKey(req)}`, config.rateLimit.maxAuth, config.rateLimit.windowMs);
  if (!rl.allowed) return Errors.rateLimited(requestId);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Errors.validation(requestId);

  const email = parsed.data.email.toLowerCase();
  const perEmail = rateLimit(`forgot:${email}`, EMAIL_BUDGET.max, EMAIL_BUDGET.windowMs);
  if (!perEmail.allowed) return Errors.rateLimited(requestId);

  // Identical response whether or not the account exists (no enumeration).
  const token = await createPasswordResetToken(email);
  if (token) {
    try {
      await sendPasswordResetEmail(email, token);
      logger.info("password reset email sent", { requestId, to: email });
    } catch (err) {
      logger.error("password reset email delivery failed", { requestId, to: email, error: String(err) });
    }
  }
  return ok({ sent: true }, { requestId });
}