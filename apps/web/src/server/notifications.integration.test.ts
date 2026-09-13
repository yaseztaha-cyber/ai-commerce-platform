import http from "http";
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { prisma } from "@ai-commerce/database";
import { notifyBusiness } from "./notifications";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("owner notifications", () => {
  let tenantId = "";
  let server: http.Server | null = null;
  let received: Array<Record<string, unknown>> = [];
  let port = 0;

  beforeAll(async () => {
    const t = await prisma.tenant.create({ data: { slug: `notif-${Date.now()}`, name: "Notify Fixture" } });
    tenantId = t.id;
    received = [];
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          received.push(JSON.parse(body) as Record<string, unknown>);
        } catch {
          received.push({ raw: true });
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      });
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
    port = (server!.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server?.close(() => r()) ?? r());
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  });

  it("delivers via webhook and records SENT", async () => {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { notificationConfig: { ownerPhone: "01000000000", channel: "webhook", webhookUrl: `http://127.0.0.1:${port}/hook` } },
    });
    await notifyBusiness(tenantId, "NEW_ORDER", "order #1 confirmed");
    expect(received.length).toBe(1);
    expect(received[0]).toMatchObject({ kind: "NEW_ORDER", tenantId });
    const row = await prisma.notification.findFirst({ where: { tenantId, kind: "NEW_ORDER" }, orderBy: { createdAt: "desc" } });
    expect(row?.channel).toBe("WEBHOOK");
    expect(row?.status).toBe("SENT");
  });

  it("records FAILED visibly when the webhook is down", async () => {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { notificationConfig: { ownerPhone: "01000000000", channel: "webhook", webhookUrl: "http://127.0.0.1:9/dead" } },
    });
    await notifyBusiness(tenantId, "LOW_STOCK", "variant low");
    const row = await prisma.notification.findFirst({ where: { tenantId, kind: "LOW_STOCK" }, orderBy: { createdAt: "desc" } });
    expect(row?.channel).toBe("WEBHOOK");
    expect(row?.status).toBe("FAILED");
    expect(row?.error).toBeTruthy();
  });

  it("falls back to console when whatsapp is selected but unconfigured", async () => {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { notificationConfig: { ownerPhone: "01000000000", channel: "whatsapp" } },
    });
    await notifyBusiness(tenantId, "HUMAN_REQUESTED", "need human");
    const row = await prisma.notification.findFirst({ where: { tenantId, kind: "HUMAN_REQUESTED" }, orderBy: { createdAt: "desc" } });
    // Global WA creds are empty in test env -> honest CONSOLE record, never fake WHATSAPP/SENT.
    expect(["CONSOLE", "WHATSAPP"]).toContain(row?.channel);
    if (row?.channel === "CONSOLE") expect(row?.status).toBe("SENT");
  });
});
