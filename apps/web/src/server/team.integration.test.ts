import { describe, expect, it, afterAll } from "vitest";
import { prisma } from "@ai-commerce/database";
import { acceptInvite, createInvite, listTeam, revokeInvite } from "./team";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("team invites", () => {
  let tenantId = "";
  let ownerId = "";
  let capTenantId = "";
  const capUserIds: string[] = [];

  afterAll(async () => {
    if (tenantId) {
      await prisma.teamInvite.deleteMany({ where: { tenantId } });
      await prisma.membership.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { email: { startsWith: "invite-" } } });
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    }
    if (capTenantId) {
      await prisma.teamInvite.deleteMany({ where: { tenantId: capTenantId } });
      await prisma.membership.deleteMany({ where: { tenantId: capTenantId } });
      await prisma.tenant.delete({ where: { id: capTenantId } }).catch(() => {});
    }
    for (const id of capUserIds) await prisma.user.delete({ where: { id } }).catch(() => {});
  });

  it("creates, lists, accepts, and blocks double-accept", async () => {
    const t = await prisma.tenant.create({ data: { slug: `team-${Date.now()}`, name: "Team Fixture" } });
    tenantId = t.id;
    const growth = await prisma.plan.findUniqueOrThrow({ where: { slug: "growth" } });
    await prisma.subscription.upsert({
      where: { tenantId },
      update: { planId: growth.id },
      create: { tenantId, planId: growth.id, status: "ACTIVE" },
    });
    const owner = await prisma.user.create({
      data: { email: `invite-owner-${Date.now()}@t.com`, name: "Owner", passwordHash: "x" },
    });
    ownerId = owner.id;
    await prisma.membership.create({ data: { tenantId, userId: ownerId, role: "OWNER" } });

    const invite = await createInvite({ tenantId, inviterUserId: ownerId, inviterRole: "OWNER", email: "invite-agent@t.com", role: "AGENT" });
    expect(invite.token).toHaveLength(64);
    const team = await listTeam(tenantId);
    expect(team.members.map((m) => m.role)).toEqual(["OWNER"]);
    expect(team.invites.map((i) => i.email)).toContain("invite-agent@t.com");
    expect(team.invites[0]).not.toHaveProperty("token"); // token never listed

    const acc = await acceptInvite({ token: invite.token, name: "Agent", password: "Agent1234!" });
    expect(acc).toMatchObject({ tenantId, role: "AGENT" });
    await expect(acceptInvite({ token: invite.token, password: "Agent1234!" })).rejects.toThrow("INVALID_OR_EXPIRED_INVITE");
  });

  it("enforces role hierarchy, expiry, and revocation", async () => {
    // ADMIN cannot invite ADMIN or OWNER
    await expect(
      createInvite({ tenantId, inviterUserId: ownerId, inviterRole: "ADMIN", email: "invite-x@t.com", role: "ADMIN" })
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      createInvite({ tenantId, inviterUserId: ownerId, inviterRole: "ADMIN", email: "invite-x@t.com", role: "OWNER" })
    ).rejects.toThrow("FORBIDDEN");
    // ADMIN can invite AGENT
    const ok = await createInvite({ tenantId, inviterUserId: ownerId, inviterRole: "ADMIN", email: "invite-y@t.com", role: "AGENT" });
    expect(ok.role).toBe("AGENT");

    // Expired invite rejected
    await prisma.teamInvite.update({ where: { id: ok.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(acceptInvite({ token: ok.token, password: "Agent1234!" })).rejects.toThrow("INVALID_OR_EXPIRED_INVITE");

    // Revoke works and unknown ids fail closed
    const r = await createInvite({ tenantId, inviterUserId: ownerId, inviterRole: "OWNER", email: "invite-z@t.com", role: "VIEWER" });
    await expect(revokeInvite(tenantId, r.id, ownerId)).resolves.toMatchObject({ revoked: true });
    await expect(revokeInvite(tenantId, r.id, ownerId)).rejects.toThrow("INVITE_NOT_FOUND");
    await expect(acceptInvite({ token: "0".repeat(64), password: "Agent1234!" })).rejects.toThrow("INVALID_OR_EXPIRED_INVITE");
  });

  it("blocks invites at the plan seat cap", async () => {
    const t = await prisma.tenant.create({ data: { slug: `team-cap-${Date.now()}`, name: "Seat Cap Fixture" } });
    capTenantId = t.id;
    const starter = await prisma.plan.findUniqueOrThrow({ where: { slug: "starter" } });
    await prisma.subscription.upsert({
      where: { tenantId: capTenantId },
      update: { planId: starter.id },
      create: { tenantId: capTenantId, planId: starter.id, status: "ACTIVE" },
    });
    const mk = async (i: number) => {
      const u = await prisma.user.create({ data: { email: `cap-${Date.now()}-${i}@t.com`, passwordHash: "x" } });
      capUserIds.push(u.id);
      await prisma.membership.create({ data: { tenantId: capTenantId, userId: u.id, role: i === 0 ? "OWNER" : "AGENT" } });
      return u.id;
    };
    const owner = await mk(0);
    await expect(
      createInvite({ tenantId: capTenantId, inviterUserId: owner, inviterRole: "OWNER", email: "cap-ok@t.com", role: "AGENT" })
    ).resolves.toMatchObject({ role: "AGENT" });
    await mk(1); // 2/2 starter seats filled
    await expect(
      createInvite({ tenantId: capTenantId, inviterUserId: owner, inviterRole: "OWNER", email: "cap-full@t.com", role: "AGENT" })
    ).rejects.toThrow("PLAN_LIMIT");
  });
});
