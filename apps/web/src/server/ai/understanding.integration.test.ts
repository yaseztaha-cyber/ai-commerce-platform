/**
 * Top-layer proof that the agent "understands" dialect questions instead of
 * memorizing names: a customer ordering in plural Egyptian Arabic succeeds
 * even when the catalog entry is English-only, and unrelated requests never
 * fabricate an order. Needs DATABASE_URL + seed (shared yasez-fashion tenant).
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@ai-commerce/database";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("agent search understanding", () => {
  let tenantId = "";
  let productId = "";
  let variantId = "";
  const createdConvos: string[] = [];
  const createdCustomers: string[] = [];

  async function cleanupProduct() {
    if (!variantId) return;
    const orders = await prisma.order.findMany({ where: { tenantId, items: { some: { variantId } } }, select: { id: true } });
    for (const o of orders) {
      await prisma.orderItem.deleteMany({ where: { orderId: o.id } });
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: o.id } });
      await prisma.order.delete({ where: { id: o.id } }).catch(() => {});
    }
    await prisma.inventoryMovement.deleteMany({ where: { variantId } });
    await prisma.inventory.deleteMany({ where: { variantId } });
    await prisma.productImage.deleteMany({ where: { productId } });
    await prisma.productVariant.delete({ where: { id: variantId } }).catch(() => {});
    await prisma.product.delete({ where: { id: productId } }).catch(() => {});
  }

  beforeAll(async () => {
    const t = await prisma.tenant.findUnique({ where: { slug: "yasez-fashion" } });
    if (!t) throw new Error("seed missing: run db:seed first");
    tenantId = t.id;
    // English-only catalog entry (no Arabic name, no aliases) on purpose.
    const p = await prisma.product.create({ data: { tenantId, name: "Sneakers 900", nameAr: null, basePrice: 1200 } });
    const v = await prisma.productVariant.create({
      data: { tenantId, productId: p.id, sku: `SNK-${Date.now()}`, attributes: { Color: "Black", Size: "42" } },
    });
    await prisma.inventory.create({ data: { tenantId, variantId: v.id, quantity: 5 } });
    productId = p.id;
    variantId = v.id;
  });

  afterAll(async () => {
    for (const cid of createdConvos) {
      await prisma.message.deleteMany({ where: { conversationId: cid } });
      await prisma.toolCall.deleteMany({ where: { conversationId: cid } });
      await prisma.aiRun.deleteMany({ where: { conversationId: cid } });
      await prisma.order.updateMany({ where: { conversationId: cid }, data: { conversationId: null } });
      await prisma.conversation.delete({ where: { id: cid } }).catch(() => {});
    }
    for (const cuid of createdCustomers) {
      await prisma.customer.delete({ where: { id: cuid } }).catch(() => {});
    }
    await cleanupProduct();
  });

  async function agentConvo(phone: string) {
    const { findOrCreateCustomer } = await import("../customers");
    const { getOrCreateConversation } = await import("../conversations");
    const customer = await findOrCreateCustomer(tenantId, phone);
    createdCustomers.push(customer.id);
    const convo = await getOrCreateConversation({ tenantId, channel: "SIMULATOR", externalId: `SIMULATOR:${phone}`, customerId: customer.id });
    createdConvos.push(convo.id);
    return { customer, convo };
  }

  it("plural Arabic question drafts an order for an English-only product", async () => {
    const { customer, convo } = await agentConvo("01090010001");
    try {
      const { runAgentTurn } = await import("./agent");
      const r = await runAgentTurn({ tenantId, conversationId: convo.id, customerId: customer.id, userText: "عندكم كوتشيات؟" });
      expect(r.toolsUsed).toContain("search_products");
      expect(r.toolsUsed).toContain("get_product");
      expect(r.toolsUsed).toContain("create_order_draft");
      expect(r.text).toContain("Sneakers");
      const draft = await prisma.order.findFirst({ where: { tenantId, conversationId: convo.id } });
      expect(draft?.status).toBe("DRAFT");
    } finally {
      const draft = await prisma.order.findFirst({ where: { tenantId, conversationId: convo.id } });
      if (draft) {
        await prisma.orderItem.deleteMany({ where: { orderId: draft.id } });
        await prisma.orderStatusHistory.deleteMany({ where: { orderId: draft.id } });
        await prisma.order.delete({ where: { id: draft.id } });
      }
    }
  });

  it("never drafts for a product the store does not carry", async () => {
    const { customer, convo } = await agentConvo("01090010002");
    const { runAgentTurn } = await import("./agent");
    const r = await runAgentTurn({ tenantId, conversationId: convo.id, customerId: customer.id, userText: "عايز جلابية قطن" });
    expect(r.toolsUsed).toContain("search_products");
    expect(r.toolsUsed).not.toContain("create_order_draft");
    expect(r.text).toMatch(/مش لاقي|توضح/);
  });
});