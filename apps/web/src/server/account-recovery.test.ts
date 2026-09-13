import { describe, expect, it, afterAll } from "vitest";
import { prisma } from "@ai-commerce/database";
import { hashPassword, verifyPassword } from "./auth";
import {
  applyPasswordResetToken,
  createPasswordResetToken,
  generateResetToken,
  RESET_MAX_ATTEMPTS,
  sha256Hex,
  tokensMatch,
} from "./account-recovery";

const hasDb = Boolean(process.env.DATABASE_URL);

describe("password reset primitives", () => {
  it("creates opaque tokens and hashes/compares them", () => {
    const t = generateResetToken();
    expect(t.length).toBeGreaterThanOrEqual(32);
    expect(t).not.toBe(generateResetToken());
    expect(sha256Hex("a")).toHaveLength(64);
    expect(sha256Hex("a")).toBe(sha256Hex("a"));
    expect(tokensMatch(sha256Hex("a"), sha256Hex("a"))).toBe(true);
    expect(tokensMatch(sha256Hex("a"), sha256Hex("b"))).toBe(false);
  });
});

describe.skipIf(!hasDb)("password reset flow (db)", () => {
  const tenantIds: string[] = [];
  const userIds: string[] = [];

  afterAll(async () => {
    for (const userId of userIds) {
      await prisma.membership.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
    for (const tenantId of tenantIds) {
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    }
  });

  async function newUser(): Promise<{ userId: string; email: string }> {
    const t = await prisma.tenant.create({ data: { slug: `rec-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, name: "Recovery Fixture" } });
    tenantIds.push(t.id);
    const user = await prisma.user.create({
      data: { email: `rec-${Date.now()}-${Math.floor(Math.random() * 1e6)}@t.com`, name: "R", passwordHash: await hashPassword("OldPass123!") },
    });
    userIds.push(user.id);
    await prisma.membership.create({ data: { tenantId: t.id, userId: user.id, role: "OWNER" } });
    return { userId: user.id, email: user.email };
  }

  it("issues a token stored hashed, applies exactly once, verifies email", async () => {
    const { userId, email } = await newUser();
    const token = await createPasswordResetToken(email);
    expect(token).toBeTruthy();

    const stored = await prisma.user.findUnique({ where: { id: userId } });
    expect(stored?.resetTokenHash).not.toBe(token);
    expect(stored?.resetTokenHash).toBe(sha256Hex(token as string));
    expect((stored?.resetExpiresAt?.getTime() ?? 0)).toBeGreaterThan(Date.now());

    const ok = await applyPasswordResetToken(token as string, "NewPass123!");
    expect(ok).toEqual({ ok: true });

    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(await verifyPassword("NewPass123!", after?.passwordHash as string)).toBe(true);
    expect(await verifyPassword("OldPass123!", after?.passwordHash as string)).toBe(false);
    expect(after?.resetTokenHash).toBeNull();
    expect(after?.emailVerifiedAt).not.toBeNull();

    const reused = await applyPasswordResetToken(token as string, "OtherPass123!");
    expect(reused).toEqual({ ok: false, error: "INVALID_OR_EXPIRED" });
  });

  it("returns null for unknown emails (no enumeration)", async () => {
    const token = await createPasswordResetToken(`nobody-${Date.now()}@t.com`);
    expect(token).toBeNull();
  });

  it("rejects an expired token", async () => {
    const { userId, email } = await newUser();
    const token = await createPasswordResetToken(email);
    await prisma.user.update({ where: { id: userId }, data: { resetExpiresAt: new Date(Date.now() - 1000) } });
    const res = await applyPasswordResetToken(token as string, "Another123!");
    expect(res).toEqual({ ok: false, error: "INVALID_OR_EXPIRED" });
  });

  it("hard-invalidates a token after the attempt cap", async () => {
    const { userId, email } = await newUser();
    const token = await createPasswordResetToken(email);
    await prisma.user.update({ where: { id: userId }, data: { resetAttempts: RESET_MAX_ATTEMPTS } });
    const res = await applyPasswordResetToken(token as string, "YetAnother123!");
    expect(res).toEqual({ ok: false, error: "TOO_MANY_ATTEMPTS" });
    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(after?.resetTokenHash).toBeNull();
  });
});