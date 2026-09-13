import crypto from "crypto";
import { prisma } from "@ai-commerce/database";
import { ROLE_RANK, type Role } from "@ai-commerce/shared";
import { hashPassword } from "./auth";
import { audit } from "./audit";

export const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
const INVITABLE_ROLES: Role[] = ["OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER"];

function assertCanInvite(inviterRole: Role, invitedRole: Role) {
  if (!INVITABLE_ROLES.includes(invitedRole)) throw new Error("INVALID_ROLE");
  if (inviterRole === "OWNER") return; // owners may invite anyone incl. owners
  if (ROLE_RANK[inviterRole] <= ROLE_RANK[invitedRole]) {
    throw new Error("FORBIDDEN: can only invite strictly lower roles");
  }
}

/** Create (or refresh) a pending invite. Returns the single-use token for the owner to share. */
export async function createInvite(input: {
  tenantId: string;
  inviterUserId: string;
  inviterRole: Role;
  email: string;
  role: Role;
}) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("INVALID_EMAIL");
  assertCanInvite(input.inviterRole, input.role);
  const { seatCountEnforced } = await import("./billing");
  const gate = await seatCountEnforced(input.tenantId);
  if (!gate.allowed) throw new Error(`PLAN_LIMIT: ${gate.message}`);

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    const already = await prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId: input.tenantId, userId: existingUser.id } },
    });
    if (already) throw new Error("ALREADY_MEMBER");
  }
  // Expire superseded pending invites for the same email (one active invite).
  await prisma.teamInvite.updateMany({
    where: { tenantId: input.tenantId, email, acceptedAt: null, expiresAt: { gt: new Date() } },
    data: { expiresAt: new Date() },
  });
  const invite = await prisma.teamInvite.create({
    data: {
      tenantId: input.tenantId,
      email,
      role: input.role,
      token: crypto.randomBytes(32).toString("hex"),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      createdById: input.inviterUserId,
    },
  });
  await audit({ tenantId: input.tenantId, actor: `user:${input.inviterUserId}`, action: "team.invite_created", resource: "invite", resourceId: invite.id, newValue: { email, role: input.role } });
  return invite;
}

/**
 * Accept an invite (public endpoint, rate-limited). Creates the user on first
 * use or links an existing account, then grants membership in the INVITE's
 * tenant — the token alone determines the tenant, never client input.
 */
export async function acceptInvite(input: { token: string; name?: string; password?: string }) {
  const invite = await prisma.teamInvite.findUnique({ where: { token: input.token } });
  if (!invite || invite.acceptedAt || invite.expiresAt.getTime() <= Date.now()) {
    throw new Error("INVALID_OR_EXPIRED_INVITE");
  }
  let user = await prisma.user.findUnique({ where: { email: invite.email } });
  if (!user) {
    if (!input.password || input.password.length < 8) throw new Error("PASSWORD_REQUIRED");
    user = await prisma.user.create({
      data: { email: invite.email, name: (input.name ?? "").slice(0, 120) || null, passwordHash: await hashPassword(input.password) },
    });
  }
  const existing = await prisma.membership.findUnique({
    where: { tenantId_userId: { tenantId: invite.tenantId, userId: user.id } },
  });
  if (existing) throw new Error("ALREADY_MEMBER");
  await prisma.$transaction([
    prisma.membership.create({ data: { tenantId: invite.tenantId, userId: user.id, role: invite.role } }),
    prisma.teamInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } }),
  ]);
  await audit({ tenantId: invite.tenantId, actor: `user:${user.id}`, action: "team.invite_accepted", resource: "invite", resourceId: invite.id });
  return { userId: user.id, tenantId: invite.tenantId, role: invite.role };
}

export async function listTeam(tenantId: string) {
  const [members, invites] = await Promise.all([
    prisma.membership.findMany({
      where: { tenantId },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.teamInvite.findMany({
      where: { tenantId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
    }),
  ]);
  return { members, invites };
}

export async function revokeInvite(tenantId: string, inviteId: string, actorUserId: string) {
  const invite = await prisma.teamInvite.findFirst({ where: { id: inviteId, tenantId } });
  if (!invite) throw new Error("INVITE_NOT_FOUND");
  await prisma.teamInvite.delete({ where: { id: invite.id } });
  await audit({ tenantId, actor: `user:${actorUserId}`, action: "team.invite_revoked", resource: "invite", resourceId: invite.id });
  return { revoked: true };
}
