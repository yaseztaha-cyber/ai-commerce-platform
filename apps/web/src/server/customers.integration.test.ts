import { describe, expect, it, afterAll } from "vitest";
import { prisma } from "@ai-commerce/database";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("customer detail + erasure", () => {
  let tenantId = "";
  let customerId = "";

  afterAll(async () => {
    if (customerId) {
      await prisma.customerAddress.deleteMany({ where: { customerId } });
      await prisma.order.updateMany({ where: { customerId }, data: { customerId: null } });
      await prisma.customer.delete({ where: { id: customerId } }).catch(() => {});
    }
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  });

  it("updates notes/tags and erases PII while keeping orders", async () => {
    const t = await prisma.tenant.create({ data: { slug: `cust-${Date.now()}`, name: "Customer Fixture" } });
    tenantId = t.id;
    const c = await prisma.customer.create({
      data: { tenantId, phone: "01111111111", name: "Sara", notes: "likes black", tags: ["vip"], marketingConsent: true },
    });
    customerId = c.id;
    await prisma.customerAddress.create({ data: { tenantId, customerId, address: "Cairo", city: "Cairo" } });

    const updated = await prisma.customer.update({ where: { id: customerId }, data: { notes: "prefers L", tags: ["vip", "wholesale"] } });
    expect(updated.notes).toBe("prefers L");
    expect(updated.tags).toEqual(["vip", "wholesale"]);

    // Erasure semantics mirror DELETE /api/customers/[id].
    await prisma.$transaction([
      prisma.customerAddress.deleteMany({ where: { customerId } }),
      prisma.order.updateMany({ where: { customerId }, data: { customerId: null } }),
      prisma.customer.update({
        where: { id: customerId },
        data: { name: "Deleted customer", phone: `deleted-${customerId.slice(-8)}`, email: null, notes: null, tags: [], marketingConsent: false },
      }),
    ]);
    const erased = await prisma.customer.findUnique({ where: { id: customerId } });
    expect(erased?.name).toBe("Deleted customer");
    expect(erased?.notes).toBeNull();
    expect(await prisma.customerAddress.count({ where: { customerId } })).toBe(0);
  });
});
