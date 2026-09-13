import { prisma } from "@ai-commerce/database";

export async function findOrCreateCustomer(tenantId: string, phone: string, name?: string) {
  const normalized = phone.replace(/[\s-]/g, "");
  let customer = await prisma.customer.findUnique({
    where: { tenantId_phone: { tenantId, phone: normalized } },
  });
  if (!customer) {
    customer = await prisma.customer.create({
      data: { tenantId, phone: normalized, name, lastSeenAt: new Date() },
    });
  } else {
    customer = await prisma.customer.update({
      where: { id: customer.id },
      data: { lastSeenAt: new Date(), ...(name && !customer.name ? { name } : {}) },
    });
  }
  return customer;
}

export async function touchCustomerStats(tenantId: string, customerId: string, orderTotal: number) {
  await prisma.customer.update({
    where: { id: customerId },
    data: { totalOrders: { increment: 1 }, totalSpent: { increment: orderTotal } },
  });
}
