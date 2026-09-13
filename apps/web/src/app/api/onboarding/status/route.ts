import { prisma } from "@ai-commerce/database";
import { Errors, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession } from "@/server/auth";
import { config } from "@/lib/env";

/** Setup checklist: makes incomplete onboarding obvious to the merchant. */
export async function GET() {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  const t = s.tenantId;
  const [products, variants, stocked, zones, docs, convos, whatsapp] = await Promise.all([
    prisma.product.count({ where: { tenantId: t } }),
    prisma.productVariant.count({ where: { tenantId: t } }),
    prisma.inventory.count({ where: { tenantId: t, quantity: { gt: 0 } } }),
    prisma.deliveryZone.count({ where: { tenantId: t, active: true } }),
    prisma.document.count({ where: { tenantId: t, status: "READY" } }),
    prisma.conversation.count({ where: { tenantId: t } }),
    prisma.integration.findFirst({ where: { tenantId: t, type: "WHATSAPP" } }),
  ]);
  const tenant = await prisma.tenant.findUnique({ where: { id: t } });
  const steps = [
    { key: "products", label: "Add products", done: products > 0, href: "/dashboard/products" },
    { key: "variants", label: "Configure variants", done: variants > 0, href: "/dashboard/products" },
    { key: "inventory", label: "Set inventory", done: stocked > 0, href: "/dashboard/inventory" },
    { key: "delivery", label: "Configure delivery zones", done: zones > 0, href: "/dashboard/settings" },
    { key: "payment", label: "Configure payment methods", done: (tenant?.paymentMethods?.length ?? 0) > 0, href: "/dashboard/settings" },
    { key: "knowledge", label: "Upload business knowledge", done: docs > 0, href: "/dashboard/knowledge" },
    { key: "voice", label: "Configure AI voice", done: Boolean(tenant?.aiGreeting || tenant?.aiInstructions), href: "/dashboard/ai-settings" },
    { key: "channel", label: "Connect messaging channel", done: whatsapp?.status === "ACTIVE" || config.whatsapp.accessToken !== "", href: "/dashboard/channels" },
    { key: "test", label: "Run test conversation", done: convos > 0, href: "/dashboard/playground" },
  ];
  const done = steps.filter((x) => x.done).length;
  return ok({ steps, done, total: steps.length, complete: done === steps.length }, { requestId });
}
