import { prisma } from "@ai-commerce/database";
import { logger } from "@/lib/logger";
import { emitOrderEvent } from "./n8n";
import { whatsappProvider } from "./messaging/whatsapp";

export interface OwnerNotifyConfig {
  ownerPhone?: string;
  channel?: "whatsapp" | "webhook" | "console";
  webhookUrl?: string;
}

function readOwnerConfig(tenant: { notificationConfig?: unknown }): OwnerNotifyConfig {
  const c = (tenant.notificationConfig ?? {}) as Record<string, unknown>;
  const channel = c.channel === "whatsapp" || c.channel === "webhook" ? c.channel : "console";
  return {
    ownerPhone: typeof c.ownerPhone === "string" ? c.ownerPhone : undefined,
    channel,
    webhookUrl: typeof c.webhookUrl === "string" ? c.webhookUrl : undefined,
  };
}

/**
 * Business notifications with real delivery:
 * - whatsapp: platform WhatsApp sender -> ownerPhone (needs global WA creds)
 * - webhook: POST JSON to owner-configured URL (SMS gateways, Slack, …)
 * - console: structured log (dev default)
 * The Notification row always records the real channel + SENT/FAILED —
 * failures are visible, never silently marked sent.
 */
export async function notifyBusiness(tenantId: string, kind: string, text: string, target?: string) {
  logger.info("business notification", { tenantId, kind });
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { notificationConfig: true } });
  const cfg = readOwnerConfig({ notificationConfig: tenant?.notificationConfig ?? null });

  let channel = "CONSOLE";
  let status = "SENT";
  let error: string | undefined;
  const resolvedTarget = target ?? cfg.ownerPhone ?? null;

  if (cfg.channel === "whatsapp" && cfg.ownerPhone && whatsappProvider.configured) {
    channel = "WHATSAPP";
    const res = await whatsappProvider.send(tenantId, { to: cfg.ownerPhone, text });
    if (!res.success) {
      status = "FAILED";
      error = (res.error ?? "send failed").slice(0, 500);
      logger.error("owner whatsapp notify failed", { tenantId, kind, error });
    }
  } else if (cfg.channel === "webhook" && cfg.webhookUrl) {
    channel = "WEBHOOK";
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(cfg.webhookUrl, {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, tenantId, text, at: new Date().toISOString() }),
        });
        if (!res.ok) throw new Error(`webhook ${res.status}`);
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      status = "FAILED";
      error = (err instanceof Error ? err.message : "webhook failed").slice(0, 500);
      logger.error("owner webhook notify failed", { tenantId, kind, error });
    }
  } else {
    if (cfg.channel !== "console") {
      logger.warn("owner notify channel misconfigured, using console", { tenantId, channel: cfg.channel });
    }
    console.log(`[NOTIFY ${kind}] tenant=${tenantId}\n${text}`);
  }

  await prisma.notification.create({
    data: { tenantId, kind, channel, target: resolvedTarget, payload: { text } as never, status, error },
  });
  if (kind === "NEW_ORDER") {
    await emitOrderEvent(tenantId, "order.created", { text }).catch(() => {});
  }
}

export async function notifyCustomer(tenantId: string, customerId: string, text: string) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId } });
  if (!customer) return;
  console.log(`[CUSTOMER NOTIFY] tenant=${tenantId} phone=${customer.phone}\n${text}`);
  await prisma.notification.create({
    data: { tenantId, kind: "CUSTOMER_UPDATE", channel: "CONSOLE", target: customer.phone, payload: { text } as never, status: "SENT" },
  });
}
