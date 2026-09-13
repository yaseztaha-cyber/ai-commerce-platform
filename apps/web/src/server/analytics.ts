import { prisma } from "@ai-commerce/database";
import { currentPeriod, getSubscription, usageForPeriod } from "./billing";

export async function overviewAnalytics(tenantId: string) {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  // Playground/test conversations (channel SIMULATOR) never count toward store metrics.
  const liveConversations = { tenantId, channel: { not: "SIMULATOR" } };
  const liveOrders = { tenantId, sourceChannel: { not: "SIMULATOR" } };
  const [todayOrders, pendingOrders, revenue, conversations, handoffs, lowStock, recentOrders, failedRuns] = await Promise.all([
    prisma.order.count({ where: { ...liveOrders, createdAt: { gte: since } } }),
    prisma.order.count({ where: { ...liveOrders, status: { in: ["DRAFT", "PENDING_CONFIRMATION", "CONFIRMED", "PROCESSING"] } } }),
    prisma.order.aggregate({ where: { ...liveOrders, status: { notIn: ["CANCELLED", "FAILED", "DRAFT"] } }, _sum: { total: true } }),
    prisma.conversation.count({ where: liveConversations }),
    prisma.conversation.count({ where: { ...liveConversations, status: "HUMAN_REQUIRED" } }),
    prisma.inventory.count({ where: { tenantId, quantity: { lte: 3 } } }),
    prisma.order.findMany({ where: liveOrders, orderBy: { createdAt: "desc" }, take: 8, include: { items: true } }),
    prisma.aiRun.count({ where: { tenantId, error: { not: null } } }),
  ]);
  const confirmed = await prisma.order.count({ where: { ...liveOrders, status: { notIn: ["DRAFT", "CANCELLED", "FAILED"] } } });
  const conversion = conversations ? Math.round((confirmed / Math.max(1, conversations)) * 100) : 0;
  const sub = await getSubscription(tenantId);
  const period = currentPeriod();
  const usage = await usageForPeriod(tenantId, period);

  // Daily orders + revenue for the last 14 days (single query, bucketed in JS).
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 13);
  const window = await prisma.order.findMany({
    where: { ...liveOrders, createdAt: { gte: start }, status: { notIn: ["DRAFT"] } },
    select: { createdAt: true, total: true, status: true },
  });
  const days: Array<{ day: string; label: string; orders: number; revenue: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const same = window.filter((o) => o.createdAt.toISOString().slice(0, 10) === key);
    days.push({
      day: key,
      label: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      orders: same.length,
      revenue: same.filter((o) => !["CANCELLED", "FAILED"].includes(o.status)).reduce((s, o) => s + o.total, 0),
    });
  }
  return {
    todayOrders,
    pendingOrders,
    revenue: revenue._sum.total ?? 0,
    conversations,
    conversionRate: conversion,
    handoffs,
    failedRuns,
    lowStock,
    recentOrders,
    daily: days,
    usage: {
      period,
      plan: sub.plan.name,
      aiRuns: { used: usage.ai_run ?? 0, limit: sub.plan.maxAiMessages },
      documents: { used: usage.document ?? 0, limit: sub.plan.maxDocuments },
      messages: { used: usage.message ?? 0, limit: null },
      transcriptions: { used: usage.transcription ?? 0, limit: null },
      visions: { used: usage.vision ?? 0, limit: null },
    },
  };
}
