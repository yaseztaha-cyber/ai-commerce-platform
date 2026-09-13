const { PrismaClient } = require("@prisma/client");
(async () => {
  const p = new PrismaClient();
  const tenants = await p.tenant.findMany({ where: { slug: { startsWith: "promo-live" } }, select: { id: true, slug: true } });
  for (const t of tenants) {
    const orders = await p.order.findMany({ where: { tenantId: t.id }, select: { id: true } });
    for (const o of orders) {
      await p.orderItem.deleteMany({ where: { orderId: o.id } });
      await p.orderStatusHistory.deleteMany({ where: { orderId: o.id } });
      await p.order.delete({ where: { id: o.id } });
    }
    await p.tenant.delete({ where: { id: t.id } });
    console.log("deleted", t.slug);
  }
  console.log(JSON.stringify(await p.tenant.findMany({ select: { slug: true } })));
  await p.$disconnect();
})();
