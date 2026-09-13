import { prisma } from "@ai-commerce/database";

/** Outbound fan-out to n8n + console log. Core works without n8n. */
export async function emitEvent(tenantId: string, event: string, payload: unknown) {
  const url = process.env.N8N_GENERIC_WEBHOOK_URL;
  if (url) {
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, tenantId, occurredAt: new Date().toISOString(), payload }),
      });
    } catch {
      /* best effort */
    }
  }
}

export async function emitOrderEvent(tenantId: string, event: string, order: unknown) {
  const url = process.env.N8N_ORDER_WEBHOOK_URL || process.env.N8N_GENERIC_WEBHOOK_URL;
  await prisma.notification.create({
    data: { tenantId, kind: event, channel: "N8N", payload: order as never, status: url ? "QUEUED" : "SKIPPED" },
  });
  if (url) {
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, tenantId, occurredAt: new Date().toISOString(), order }),
      });
      await prisma.notification.updateMany({ where: { tenantId, kind: event, status: "QUEUED" }, data: { status: "SENT" } });
    } catch (e) {
      await prisma.notification.updateMany({ where: { tenantId, kind: event, status: "QUEUED" }, data: { status: "FAILED", error: String(e).slice(0, 300) } });
    }
  }
  await emitEvent(tenantId, event, order);
}
