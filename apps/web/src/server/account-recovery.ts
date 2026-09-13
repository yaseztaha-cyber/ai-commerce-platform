import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { prisma } from "@ai-commerce/database";
import { hashPassword } from "./auth";
import { audit } from "./audit";

export const RESET_TOKEN_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
export const RESET_MAX_ATTEMPTS = 5;

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function generateResetToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Constant-time comparison of two token hashes (both must already be hex digests). */
export function tokensMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Issues a reset token for the given email. Returns the plaintext token (to
 * email it) or null for unknown emails — callers MUST respond identically to
 * both so accounts cannot be enumerated through this endpoint.
 */
export async function createPasswordResetToken(email: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return null;
  const token = generateResetToken();
  // Stored hashed + 6h expiry; reissuing simply overwrites any previous token
  // (old links die immediately, enforcing single active reset).
  await prisma.user.update({
    where: { id: user.id },
    data: {
      resetTokenHash: sha256Hex(token),
      resetExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      resetAttempts: 0,
    },
  });
  return token;
}

export type ResetResult = { ok: true } | { ok: false; error: "INVALID_OR_EXPIRED" | "TOO_MANY_ATTEMPTS" };

/**
 * Applies a reset token: consumes it atomically with the new password on
 * success (single use). A successful reset also marks the email as verified
 * (the reset proves control of the inbox).
 */
export async function applyPasswordResetToken(token: string, newPassword: string): Promise<ResetResult> {
  const user = await prisma.user.findUnique({ where: { resetTokenHash: sha256Hex(token) } });
  if (!user) return { ok: false, error: "INVALID_OR_EXPIRED" };
  if (user.resetAttempts >= RESET_MAX_ATTEMPTS) {
    await prisma.user.update({ where: { id: user.id }, data: { resetTokenHash: null, resetExpiresAt: null } });
    return { ok: false, error: "TOO_MANY_ATTEMPTS" };
  }
  if (!user.resetExpiresAt || user.resetExpiresAt.getTime() < Date.now()) {
    await prisma.user.update({ where: { id: user.id }, data: { resetTokenHash: null, resetExpiresAt: null, resetAttempts: { increment: 1 } } });
    return { ok: false, error: "INVALID_OR_EXPIRED" };
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      resetTokenHash: null,
      resetExpiresAt: null,
      resetAttempts: 0,
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
    },
  });
  const membership = await prisma.membership.findFirst({ where: { userId: user.id } });
  await audit({
    tenantId: membership?.tenantId ?? "none",
    actor: `user:${user.id}`,
    action: "auth.password_reset",
    resource: "user",
    resourceId: user.id,
  });
  return { ok: true };
}