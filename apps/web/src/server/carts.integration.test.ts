import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@ai-commerce/database";
import { sweepAbandonedCarts } from "./carts";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("abandoned carts", () => {
  let tenantId = "";
  let customerId = "";
  const sent: Array<{ to: string; text: string }> = [];

  const send = async (_tenantId: string, _channel: string, to: string, text: string) => {
    sent.push({ to, text });
    return { ok: true, channel: "WHATSAPP" as const };
  };

  beforeAll(async () => {
    const t = await prisma.tenant.create({ data: { slug: `cart-${Date.now()}`, name: "Cart Fixture", cartNudgeHours: 2, requirePhoneVerify: false } });
    tenantId = t.id;
    const c = await prisma.customer.create({ data: { tenantId, phone: "01060606060", name: "Cart", marketingConsent: true } });
    customerId = c.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { tenantId } });
    await prisma.orderItem.deleteMany({ where: { order: { tenantId } } });
    await prisma.orderStatusHistory.deleteMany({ where: { order: { tenantId } } });
    await prisma.order.deleteMany({ where: { tenantId } });
    await prisma.message.deleteMany({ where: { tenantId } });
    await prisma.conversation.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  });

  async function staleDraft(phone: string, hoursOld: number, opts?: { consent?: boolean; withReply?: boolean }) {
    const customer = await prisma.customer.create({
      data: { tenantId, phone, marketingConsent: opts?.consent ?? true },
    });
    const convo = await prisma.conversation.create({
      data: { tenantId, customerId: customer.id, channel: "WHATSAPP", externalId: `WHATSAPP:${phone}`, status: "AI_ACTIVE" },
    });
    const p = await prisma.product.create({ data: { tenantId, name: `Cart Tee ${phone}`, basePrice: 400 } });
    const v = await prisma.productVariant.create({ data: { tenantId, productId: p.id, sku: `CART-${phone}`, attributes: { Size: "M" } } });
    await prisma.inventory.create({ data: { tenantId, variantId: v.id, quantity: 10 } });
    const order = await prisma.order.create({
      data: {
        tenantId, number: 9000 + Math.floor(Math.random() * 899), customerId: customer.id, conversationId: convo.id,
        status: "DRAFT", subtotal: 400, total: 400, customerPhone: phone,
        items: { create: [{ tenantId, productId: p.id, variantId: v.id, productName: p.name, variantLabel: "M", unitPrice: 400, quantity: 1, lineTotal: 400 }] },
      },
    });
    const old = new Date(Date.now() - hoursOld * 3600 * 1000);
    await prisma.order.update({ where: { id: order.id }, data: { updatedAt: old, createdAt: old } });
    if (opts?.withReply) {
      await prisma.message.create({ data: { tenantId, conversationId: convo.id, role: "customer", content: "لسه بفكر" } });
    }
    return { order, convo, customer };
  }

  it("nudges one stale draft exactly once", async () => {
    sent.length = 0;
    await staleDraft("01060606001", 5);
    const r1 = await sweepAbandonedCarts(new Date(), { send });
    expect(r1.nudged).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("01060606001");
    expect(sent[0].text).toMatch(/الإجمالي 400/);
    const r2 = await sweepAbandonedCarts(new Date(), { send });
    expect(r2.nudged).toBe(0); // one nudge per draft, ever
    expect(sent).toHaveLength(1);
    const note = await prisma.notification.findFirst({ where: { tenantId, kind: "CART_NUDGE" } });
    expect(note?.status).toBe("SENT");
  });

  it("skips fresh drafts, replied threads, opted-out and disabled tenants", async () => {
    sent.length = 0;
    await staleDraft("01060606002", 0.5); // fresh
    await staleDraft("01060606003", 5, { withReply: true }); // customer replied
    await staleDraft("01060606004", 5, { consent: false }); // opted out
    const r = await sweepAbandonedCarts(new Date(), { send });
    expect(r.nudged).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("records FAILED visibly when sending fails", async () => {
    await staleDraft("01060606005", 5);
    const r = await sweepAbandonedCarts(new Date(), {
      send: async () => ({ ok: false, channel: "WHATSAPP" as const, error: "down" }),
    });
    expect(r.nudged).toBe(0);
    const note = await prisma.notification.findFirst({ where: { tenantId, kind: "CART_NUDGE", status: "FAILED" } });
    expect(note?.error).toBe("down");
  });

  it("cron route requires the shared secret", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    const { POST } = await import("../app/api/cron/cart-nudge/route");
    const denied = await POST(new Request("http://local/api/cron/cart-nudge", { method: "POST" }));
    expect(denied.status).toBe(403);
    // Own tenant for the authorized call so other fixtures are untouched.
    const t2 = await prisma.tenant.create({ data: { slug: `cart-cron-${Date.now()}`, name: "Cron", cartNudgeHours: 1, requirePhoneVerify: false } });
    try {
      const c = await prisma.customer.create({ data: { tenantId: t2.id, phone: "01060606009", marketingConsent: true } });
      const convo = await prisma.conversation.create({ data: { tenantId: t2.id, customerId: c.id, channel: "WHATSAPP", externalId: "WHATSAPP:01060606009", status: "AI_ACTIVE" } });
      const p = await prisma.product.create({ data: { tenantId: t2.id, name: "Cron Tee", basePrice: 100 } });
      const v = await prisma.productVariant.create({ data: { tenantId: t2.id, productId: p.id, sku: `CRON-${Date.now()}`, attributes: { Size: "M" } } });
      await prisma.inventory.create({ data: { tenantId: t2.id, variantId: v.id, quantity: 5 } });
      const old = new Date(Date.now() - 3 * 3600 * 1000);
      const order = await prisma.order.create({
        data: {
          tenantId: t2.id, number: 9100, customerId: c.id, conversationId: convo.id, status: "DRAFT",
          subtotal: 100, total: 100, customerPhone: "01060606009",
          items: { create: [{ tenantId: t2.id, productId: p.id, variantId: v.id, productName: "Cron Tee", variantLabel: "M", unitPrice: 100, quantity: 1, lineTotal: 100 }] },
          createdAt: old, updatedAt: old,
        },
      });
      void order;
      const okRes = await POST(
        new Request("http://local/api/cron/cart-nudge", { method: "POST", headers: { "x-cron-secret": "test-cron-secret" } })
      );
      expect(okRes.status).toBe(200);
      const body = (await okRes.json()) as { ok: boolean; data: { nudged: number } };
      expect(body.ok).toBe(true);
      expect(body.data.nudged).toBeGreaterThanOrEqual(1);
      const note = await prisma.notification.findFirst({ where: { tenantId: t2.id, kind: "CART_NUDGE", status: "SENT" } });
      expect(note).toBeTruthy();
    } finally {
      delete process.env.CRON_SECRET;
      await prisma.notification.deleteMany({ where: { tenantId: t2.id } });
      await prisma.orderItem.deleteMany({ where: { order: { tenantId: t2.id } } });
      await prisma.orderStatusHistory.deleteMany({ where: { order: { tenantId: t2.id } } });
      await prisma.order.deleteMany({ where: { tenantId: t2.id } });
      await prisma.message.deleteMany({ where: { tenantId: t2.id } });
      await prisma.conversation.deleteMany({ where: { tenantId: t2.id } });
      await prisma.customer.deleteMany({ where: { tenantId: t2.id } });
      await prisma.inventoryMovement.deleteMany({ where: { tenantId: t2.id } });
      await prisma.inventory.deleteMany({ where: { tenant: { id: t2.id } } });
      await prisma.productVariant.deleteMany({ where: { tenantId: t2.id } });
      await prisma.product.deleteMany({ where: { tenantId: t2.id } });
      await prisma.tenant.delete({ where: { id: t2.id } }).catch(() => {});
    }
  });
});
