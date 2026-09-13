import { prisma } from "@ai-commerce/database";
import {
  extractQuantity,
  normalizeColorToken,
  normalizeSizeToken,
  wantsHuman,
  isCancellation,
  isConfirmation,
  isPromoQuestion,
  signalTokens,
  isSizeAdvice,
  extractBodyMetrics,
  extractRememberedSize,
  MAX_TOOL_CALLS_DEFAULT,
} from "@ai-commerce/shared";
import { config } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getLLMProvider, type LlmTurn } from "./llm";
import { buildSystemPrompt } from "./prompts";
import { buildConversationSummary, needsSummary } from "./summary";
import { executeTool, toolDefinitions, type ToolContext, type ToolResult } from "./tools";
import { variantLabel } from "../products";
import { recentMessages, requestHuman } from "../conversations";

export interface AgentReply {
  text: string;
  escalated?: boolean;
  orderId?: string;
  toolsUsed: string[];
  /** Optional product photo, sent as a native image message where supported. */
  image?: { url: string; caption?: string };
}

interface Candidate {
  id: string;
  name: string;
  nameAr?: string | null;
  basePrice?: number;
  score: number;
  matchedOn?: string;
}

/**
 * Deterministic agent orchestrator.
 * LLM proposes actions; THIS module enforces the order state machine,
 * safety policies, and composes replies only from verified tool results.
 */
export async function runAgentTurn(input: {
  tenantId: string;
  conversationId: string;
  customerId?: string;
  userText: string;
  requestId?: string;
}): Promise<AgentReply> {
  const { tenantId, conversationId, userText } = input;
  const maxCalls = config.llm.maxToolCalls || MAX_TOOL_CALLS_DEFAULT;
  const toolsUsed: string[] = [];

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: { deliveryZones: { where: { active: true } } },
  });
  if (!tenant) throw new Error("TENANT_NOT_FOUND");

  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, tenantId } });
  if (!conversation) throw new Error("CONVERSATION_NOT_FOUND");

  // AI must stay silent when a human owns the conversation
  if (conversation.status === "HUMAN_ACTIVE") {
    return { text: "", toolsUsed };
  }

  // Plan-limit gate (service-layer, unbypassable): over-limit tenants get a
  // human escalation instead of burning more AI usage.
  const { checkLimit, meter } = await import("../billing");
  const gate = await checkLimit(tenantId, "ai_run");
  if (!gate.allowed) {
    await prisma.aiRun.create({
      data: { tenantId, conversationId, provider: "none", model: "limit", promptVersion: "v1", error: gate.code },
    });
    await requestHuman(tenantId, conversationId, `plan limit: ${gate.message}`).catch(() => {});
    return {
      text: ar("وصلنا للحد الشهري للردود الذكية في خطتك. حوّلتك لفريق المتجر وهيكمل معاك.", tenant),
      toolsUsed,
      escalated: true,
    };
  }

  const aiRun = await prisma.aiRun.create({
    data: { tenantId, conversationId, provider: config.llm.provider, model: config.llm.model, promptVersion: "v1" },
  });
  void meter(tenantId, "ai_run");
  const tctx: ToolContext = { tenantId, conversationId, customerId: input.customerId, aiRunId: aiRun.id, actor: "ai" };
  const started = Date.now();

  const fail = async (text: string, escalate = false): Promise<AgentReply> => {
    await prisma.aiRun.update({ where: { id: aiRun.id }, data: { latencyMs: Date.now() - started, result: text.slice(0, 1000), toolsUsed } });
    if (escalate) await requestHuman(tenantId, conversationId, "agent fallback").catch(() => {});
    return { text, toolsUsed, escalated: escalate || undefined };
  };

  // ---- explicit escalation ----
  if (wantsHuman(userText) || isCancellation(userText) && /انسان|حد|موظف/i.test(userText)) {
    await executeTool(tctx, "request_human", { reason: userText.slice(0, 200) });
    toolsUsed.push("request_human");
    await prisma.aiRun.update({ where: { id: aiRun.id }, data: { latencyMs: Date.now() - started, result: "escalated", toolsUsed } });
    return { text: ar(`تمام، هحوّلك لحد من فريق ${tenant.name} وهيكمل معاك فوراً.`, tenant) + ` ✅`, toolsUsed, escalated: true };
  }
  if (isCancellation(userText) && conversation.draftOrderId) {
    const res = await executeTool(tctx, "cancel_order", { order_id: conversation.draftOrderId });
    toolsUsed.push("cancel_order");
    if (res.success) {
      await prisma.conversation.update({ where: { id: conversationId }, data: { draftOrderId: null, orderState: "DISCOVERY" } });
      return { text: ar("تمام، لغيت المسودة. لو حابب حاجة تانية قولي.", tenant), toolsUsed };
    }
  }

  // ---- load memory ----
  // ---- load memory (bounded: full window for the summary, last 8 for the model) ----
  const history = await recentMessages(tenantId, conversationId, 24);
  const draft = conversation.draftOrderId
    ? await prisma.order.findFirst({ where: { id: conversation.draftOrderId, tenantId }, include: { items: true } })
    : null;

  // Confirmation path: explicit yes + existing draft -> confirm transactionally
  if (isConfirmation(userText)) {
    if (draft && ["DRAFT", "PENDING_CONFIRMATION"].includes(draft.status)) {
      const res = await executeTool(tctx, "confirm_order", { order_id: draft.id, idempotency_key: draft.id });
      toolsUsed.push("confirm_order");
      if (res.success) {
        const d = res.data as { number?: number | null; total?: number };
        await prisma.conversation.update({ where: { id: conversationId }, data: { draftOrderId: null } });
        await prisma.aiRun.update({ where: { id: aiRun.id }, data: { latencyMs: Date.now() - started, result: `order #${d.number}`, toolsUsed } });
        return {
          text: ar(`تم تأكيد الأوردر ✅ رقم #${d.number}. الإجمالي ${d.total} ${tenant.currency}. المتجر هيبدأ تجهيزه وهيوصلك تحديث بالحالة.`, tenant),
          toolsUsed,
          orderId: draft.id,
        };
      }
      // COD protection: phone not verified -> send an SMS code first.
      if (res.error?.code === "PHONE_NOT_VERIFIED" || (res.error?.message ?? "").includes("PHONE_NOT_VERIFIED")) {
        const sent = await executeTool(tctx, "send_verification_code", { order_id: draft.id });
        toolsUsed.push("send_verification_code");
        await prisma.aiRun.update({ where: { id: aiRun.id }, data: { latencyMs: Date.now() - started, result: "verification_sent", toolsUsed } });
        if (sent.success) {
          const cooldown = (sent.data as { cooldownMs?: number })?.cooldownMs ?? 0;
          return {
            text: ar(
              cooldown > 0
                ? `بعتلك الكود من شوية على موبايلك — اكتبه هنا عشان أأكد الأوردر.`
                : `تمام! بعتلك كود تأكيد على موبايلك 📲 اكتبه هنا عشان أأكد الأوردر.`,
              tenant
            ),
            toolsUsed,
          };
        }
        return fail(ar("مقدرتش ابعت كود التأكيد دلوقتي. هحوّلك لحد من الفريق يساعدك.", tenant), true);
      }
      const err = (res.error?.message ?? "").toUpperCase();
      if (err.includes("INSUFFICIENT_STOCK")) {
        await prisma.conversation.update({ where: { id: conversationId }, data: { draftOrderId: null, orderState: "DISCOVERY" } });
        return fail(ar("للأسف القطعة دي خلصت قبل التأكيد. تحب أرشحلك بديل متوفر؟", tenant));
      }
      return fail(ar("حصلت مشكلة في تأكيد الأوردر. هحوّلك لحد من الفريق يساعدك.", tenant), true);
    }
    // "Confirm" with no open draft: report the latest order state instead of
    // pretending nothing exists (prevents duplicate-order confusion).
    const latest = await prisma.order.findFirst({
      where: { tenantId, conversationId, status: { not: "DRAFT" } },
      orderBy: { createdAt: "desc" },
    });
    if (latest) {
      await prisma.aiRun.update({ where: { id: aiRun.id }, data: { latencyMs: Date.now() - started, result: `order #${latest.number} ${latest.status}`, toolsUsed } });
      return {
        text: ar(`الأوردر #${latest.number} حالته الحالية: ${latest.status}. الإجمالي ${latest.total} ${tenant.currency}.`, tenant),
        toolsUsed,
        orderId: latest.id,
      };
    }
  }

  // Verification-code path: 4-8 digits + open draft -> check code, then confirm.
  // Never confirms on a wrong/expired/locked code.
  if (/^\d{4,8}$/.test(userText.trim())) {
    if (draft && ["DRAFT", "PENDING_CONFIRMATION"].includes(draft.status)) {
      const code = userText.trim();
      const check = await executeTool(tctx, "verify_phone_code", { order_id: draft.id, code });
      toolsUsed.push("verify_phone_code");
      if (check.success) {
        const res = await executeTool(tctx, "confirm_order", { order_id: draft.id, idempotency_key: draft.id });
        toolsUsed.push("confirm_order");
        if (res.success) {
          const d = res.data as { number?: number | null; total?: number };
          await prisma.conversation.update({ where: { id: conversationId }, data: { draftOrderId: null } });
          await prisma.aiRun.update({ where: { id: aiRun.id }, data: { latencyMs: Date.now() - started, result: `order #${d.number}`, toolsUsed } });
          return {
            text: ar(`الكود صح ✅ تم تأكيد الأوردر رقم #${d.number}. الإجمالي ${d.total} ${tenant.currency}. المتجر هيبدأ تجهيزه.`, tenant),
            toolsUsed,
            orderId: draft.id,
          };
        }
        const err = (res.error?.message ?? "").toUpperCase();
        if (err.includes("INSUFFICIENT_STOCK")) {
          await prisma.conversation.update({ where: { id: conversationId }, data: { draftOrderId: null, orderState: "DISCOVERY" } });
          return fail(ar("للأسف القطعة دي خلصت قبل التأكيد. تحب أرشحلك بديل متوفر؟", tenant));
        }
        return fail(ar("حصلت مشكلة في تأكيد الأوردر. هحوّلك لحد من الفريق يساعدك.", tenant), true);
      }
      const kind = check.error?.code ?? "WRONG";
      if (kind === "WRONG") {
        return { text: ar(check.error?.message ?? "الكود غلط. حاول تاني.", tenant), toolsUsed };
      }
      if (kind === "EXPIRED" || kind === "LOCKED" || kind === "NOT_FOUND") {
        return fail(ar(`${check.error?.message ?? "الكود مش صالح."} هحوّلك لحد من الفريق يساعدك.`, tenant), true);
      }
      return { text: ar(check.error?.message ?? "مقدرتش أتحقق من الكود.", tenant), toolsUsed };
    }
  }

  // ---- build prompt context ----
  const priorProductId = extractPriorProductId(history);
  const ctxJson = JSON.stringify({
    productId: priorProductId ?? undefined,
    draftId: draft && ["DRAFT", "PENDING_CONFIRMATION"].includes(draft.status) ? draft.id : undefined,
    orderState: conversation.orderState,
  });

  const orderContext = draft
    ? `Draft ${draft.id} (${draft.status}): ${draft.items.map((i) => `${i.productName} ${i.variantLabel} x${i.quantity}`).join("; ")}. Total ${draft.total}.` +
      (tenant.requirePhoneVerify ? " Phone verification REQUIRED: confirm_order fails with PHONE_NOT_VERIFIED until send_verification_code + verify_phone_code succeed for this order." : "")
    : "";
  const customer = input.customerId ? await prisma.customer.findFirst({ where: { id: input.customerId, tenantId } }) : null;

  const system = buildSystemPrompt({
    tenant: {
      name: tenant.name,
      language: tenant.language,
      personality: tenant.aiPersonality,
      tone: tenant.aiTone,
      greeting: tenant.aiGreeting,
      instructions: tenant.aiInstructions,
      forbiddenPhrases: tenant.forbiddenPhrases,
      currency: tenant.currency,
      deliverySummary: tenant.deliveryZones.map((z) => `${z.name} ${z.fee}`).join(", ") || "COD",
      policiesSummary: [tenant.returnPolicy, tenant.exchangePolicy, tenant.shippingPolicy].filter(Boolean).join(" | ").slice(0, 400),
    },
    conversationState: needsSummary(history.length)
      ? `${conversation.orderState}\nEarlier turns: ${buildConversationSummary(history)}`
      : conversation.orderState,
    orderContext,
    customerContext: customer
      ? `phone=${customer.phone} name=${customer.name ?? "-"} orders=${customer.totalOrders}${customer.preferredSize ? ` known_size=${customer.preferredSize} (customer-confirmed, may suggest "same as last time")` : ""}`
      : "",
    knowledge: "",
    ctxJson,
  });

  // ---- LLM propose -> tools loop ----
  const llm = getLLMProvider();
  const messages = [
    ...history.slice(-8).map((m) => ({ role: (m.role === "customer" ? "user" : "assistant") as "user" | "assistant", content: m.content })),
    { role: "user" as const, content: userText },
  ];

  let turn: LlmTurn;
  try {
    turn = await llm.generate({ system, messages, tools: toolDefinitions(), maxToolCalls: maxCalls });
    // Record the ACTUAL provider/model used (post-fallback) + token usage.
    await prisma.aiRun
      .update({
        where: { id: aiRun.id },
        data: {
          provider: turn.provider ?? llm.name,
          model: turn.model ?? llm.model,
          inputTokens: turn.inputTokens,
          outputTokens: turn.outputTokens,
          costEstimate: turn.costEstimate,
        },
      })
      .catch(() => {});
  } catch (err) {
    const safe = err instanceof Error ? err.message.slice(0, 300) : "LLM failed";
    logger.error("llm failed", { tenantId, conversationId, error: safe });
    await prisma.aiRun.update({ where: { id: aiRun.id }, data: { error: safe } }).catch(() => {});
    return fail(ar("عندي مشكلة تقنية دلوقتي. هحوّلك لحد من الفريق.", tenant), true);
  }

  const acc = {
    candidates: [] as Candidate[],
    product: null as null | { id: string; name: string; name_ar: string | null; base_price: number; variants: Array<{ variant_id: string; sku: string; price: number; attributes: Record<string, string>; label: string; stock: number; active: boolean }> },
    passages: [] as Array<{ title: string; content: string; score: number }>,
    inventoryChecks: [] as Array<{ variant_id: string; available: number; requested: number; in_stock: boolean }>,
    draftCreated: null as null | { order_id: string; subtotal: number; delivery_fee: number; total: number },
    promotions: [] as Array<{ name: string; kind: string; value: number; min_subtotal: number | null; buy_qty: number | null; get_qty: number | null; ends_at: string | null }>,
  };

  let calls = 0;
  const queue: Array<{ name: string; args: Record<string, unknown> }> =
    turn.toolCalls?.map((c) => ({ name: c.name, args: c.arguments })) ?? [];

  // Orchestrator guarantee: transactional queries always hit structured tools first.
  if (queue.length === 0 && turn.text && turn.text.length > 0 && !draft) {
    queue.push({ name: "search_products", args: { query: userText } });
  }

  while (queue.length > 0) {
    if (calls >= maxCalls) {
      logger.warn("max tool calls exceeded", { tenantId, conversationId });
      return fail(ar("معلش، الموضوع محتاج متابعة بشرية. هحوّلك لحد من الفريق.", tenant), true);
    }
    const call = queue.shift()!;
    calls++;
    toolsUsed.push(call.name);
    const res: ToolResult = await executeTool(tctx, call.name, call.args);
    if (!res.success) {
      if (call.name === "search_products") acc.candidates = [];
      continue;
    }
    const d = res.data as Record<string, unknown>;
    if (call.name === "search_products") acc.candidates = ((d.candidates ?? []) as Candidate[]).slice(0, 5);
    if (call.name === "get_product") acc.product = d as never;
    if (call.name === "search_business_knowledge") acc.passages = (d.passages ?? []) as never;
    if (call.name === "check_inventory") acc.inventoryChecks.push(d as never);
    if (call.name === "get_promotions") acc.promotions = ((d.promotions ?? []) as never[]).slice(0, 5) as never;
  }

  // Mixed intent: product question + policy question -> fetch knowledge too
  if (acc.candidates.length > 0 && /سياسه|سياسة|استبدال|استرجاع|شحن|توصيل|دفع/i.test(userText) && acc.passages.length === 0 && calls < maxCalls) {
    const res = await executeTool(tctx, "search_business_knowledge", { query: userText });
    toolsUsed.push("search_business_knowledge");
    calls++;
    if (res.success) acc.passages = ((res.data as { passages: never[] }).passages ?? []) as never;
  }
  // Pure knowledge question with no product mention
  if (acc.candidates.length === 0 && queue.length === 0 && acc.passages.length === 0 && /سياسه|سياسة|استبدال|استرجاع|شحن|توصيل|دفع|مواعيد|عنوان|ضمان/i.test(userText)) {
    const res = await executeTool(tctx, "search_business_knowledge", { query: userText });
    toolsUsed.push("search_business_knowledge");
    if (res.success) {
      acc.passages = ((res.data as { passages: never[] }).passages ?? []) as never;
      if (acc.passages.length > 0) {
        const reply = composeKnowledgeReply(acc.passages, tenant.language);
        await prisma.aiRun.update({ where: { id: aiRun.id }, data: { latencyMs: Date.now() - started, result: reply.slice(0, 1000), toolsUsed } });
        return { text: reply, toolsUsed };
      }
    }
  }

  // ---- deterministic state machine over verified results ----
  const reply = await decideNextStep({
    tenant: { name: tenant.name, currency: tenant.currency, language: tenant.language, deliveryZones: tenant.deliveryZones.map((z) => ({ id: z.id, name: z.name, nameAr: z.nameAr, fee: z.fee })) },
    userText,
    conversationId,
    tenantId,
    tctx,
    acc,
    priorProductId,
    toolsUsed,
    maxCalls,
    calls,
  });

  await prisma.aiRun.update({
    where: { id: aiRun.id },
    data: { latencyMs: Date.now() - started, result: reply.text.slice(0, 1000), toolsUsed },
  });
  return reply;
}

function ar(text: string, tenant: { language: string }): string {
  void tenant;
  return text; // tenant language already ar-EG default; EN templates chosen by caller when needed
}

function extractPriorProductId(history: Array<{ toolCalls?: unknown }>): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const tc = history[i].toolCalls as Array<{ name?: string; arguments?: Record<string, unknown> }> | null;
    if (Array.isArray(tc)) {
      for (let j = tc.length - 1; j >= 0; j--) {
        const args = tc[j]?.arguments as Record<string, unknown> | undefined;
        if (args?.product_id && typeof args.product_id === "string") return args.product_id;
        if (args?.productId && typeof args.productId === "string") return args.productId;
      }
    }
  }
  return undefined;
}

function composeKnowledgeReply(passages: Array<{ title: string; content: string }>, _lang: string): string {
  const top = passages.slice(0, 2).map((p) => p.content).join("\n\n").slice(0, 800);
  return `${top}`;
}

function describePromo(
  p: { name: string; kind: string; value: number; min_subtotal: number | null; buy_qty: number | null; get_qty: number | null; ends_at: string | null },
  cur: string
): string {
  const min = p.min_subtotal ? ` (على طلبات فوق ${p.min_subtotal} ${cur})` : "";
  let end = "";
  try {
    if (p.ends_at) end = ` — لحد ${new Date(p.ends_at).toLocaleDateString("ar-EG")}`;
  } catch {
    /* ignore bad dates */
  }
  switch (p.kind) {
    case "PERCENT":
      return `• ${p.name}: خصم ${p.value}%${min}${end}`;
    case "FIXED":
      return `• ${p.name}: خصم ${p.value} ${cur}${min}${end}`;
    case "BXGY":
      return `• ${p.name}: اشترِ ${p.buy_qty ?? "?"} وخد ${p.get_qty ?? "?"} هدية${min}${end}`;
    case "FREE_SHIPPING":
      return `• ${p.name}: شحن مجاني${min}${end}`;
    default:
      return `• ${p.name}${min}${end}`;
  }
}

/** Offer list composed ONLY from verified tool results. Empty input never happens (caller checks). */
export function composePromoReply(
  promos: Array<{ name: string; kind: string; value: number; min_subtotal: number | null; buy_qty: number | null; get_qty: number | null; ends_at: string | null }>,
  cur: string
): string {
  const lines = promos.slice(0, 4).map((p) => describePromo(p, cur));
  return `عروضنا الحالية:\n${lines.join("\n")}\nتحب تطلب حاجة منهم؟`;
}

async function decideNextStep(args: {
  tenant: { name: string; currency: string; language: string; deliveryZones: Array<{ id: string; name: string; nameAr: string | null; fee: number }> };
  userText: string;
  conversationId: string;
  tenantId: string;
  tctx: ToolContext;
  acc: {
    candidates: Candidate[];
    product: null | { id: string; name: string; name_ar: string | null; base_price: number; images?: Array<{ url: string }>; variants: Array<{ variant_id: string; sku: string; price: number; attributes: Record<string, string>; label: string; stock: number; active: boolean }> };
    inventoryChecks: Array<{ variant_id: string; available: number; requested: number; in_stock: boolean }>;
    passages: Array<{ title: string; content: string; score: number }>;
    promotions?: Array<{ name: string; kind: string; value: number; min_subtotal: number | null; buy_qty: number | null; get_qty: number | null; ends_at: string | null }>;
  };
  priorProductId?: string;
  toolsUsed: string[];
  maxCalls: number;
  calls: number;
}): Promise<AgentReply> {
  const { tenant, userText, tctx, acc, toolsUsed } = args;
  const cur = tenant.currency;

  // Explicit size opt-in ("my size is always L"): product-independent.
  const remembered = extractRememberedSize(userText);
  if (remembered && tctx.customerId) {
    const res = await executeTool(tctx, "remember_customer_size", { size: remembered });
    toolsUsed.push("remember_customer_size");
    if (res.success) {
      await prisma.conversation.update({ where: { id: args.conversationId }, data: { orderState: "VARIANT_SELECTION" } });
      return { text: `تمام، سجلت إن مقاسك ${remembered} ✅ هستخدمه لما تطلب.`, toolsUsed };
    }
  }

  // Offer question with no product attached: answer ONLY from the
  // structured promo tool (never invent deals), then stop.
  if (isPromoQuestion(userText) && acc.candidates.length === 0 && !acc.product && !args.priorProductId) {
    if (acc.promotions!.length === 0 && args.calls < args.maxCalls) {
      const res = await executeTool(tctx, "get_promotions", {});
      toolsUsed.push("get_promotions");
      if (res.success) acc.promotions = ((res.data as { promotions?: never[] }).promotions ?? []) as never;
    }
    if ((acc.promotions?.length ?? 0) > 0) {
      return { text: composePromoReply(acc.promotions!, cur), toolsUsed };
    }
    // else: fall through to the normal not-found path (no offers to quote)
  }

  // No candidates at all
  if (acc.candidates.length === 0 && !acc.product && !args.priorProductId) {
    // Pure knowledge question (planner already retrieved passages): answer
    // from RAG without a misleading "product not found" prefix.
    if (acc.passages.length > 0) {
      let text = composeKnowledgeReply(acc.passages, tenant.language);
      if (signalTokens(userText).length > 0) {
        text += "\n\nوبالنسبة للمخزون: ممكن توضح اسم المنتج والمقاس بالظبط عشان أتأكدلك؟";
      }
      return { text, toolsUsed };
    }
    const kb = acc.passages.length ? `\n\n${acc.passages[0].content.slice(0, 400)}` : "";
    return {
      text: `معلش، مش لاقي المنتج ده عندنا حالياً. ممكن توضح الاسم أو تبعت صورة؟ تحب أحوّلك لحد من الفريق؟${kb}`,
      toolsUsed,
    };
  }

  // Advice follow-up ("my size?" after a product is established): pin the
  // known product directly instead of failing on empty search results.
  if (isSizeAdvice(userText) && !acc.product && args.priorProductId && args.calls < args.maxCalls) {
    const res = await executeTool(tctx, "get_product", { product_id: args.priorProductId });
    toolsUsed.push("get_product");
    if (res.success) acc.product = res.data as never;
  }

  // Ambiguous: exact matches pin immediately; otherwise require a clear
  // margin (never silently pick an uncertain product).
  const [top, second] = acc.candidates;
  const gap = top && second ? top.score - second.score : 1;
  if (!acc.product && top && top.score < 0.98 && (top.score < 0.34 || gap < 0.1)) {
    const options = acc.candidates.slice(0, 3).map((c) => `• ${c.nameAr ?? c.name} (${c.basePrice} ${cur})`).join("\n");
    await prisma.conversation.update({ where: { id: args.conversationId }, data: { orderState: "DISCOVERY" } });
    // Mixed query: answer the knowledge part too, from verified RAG only.
    const extra = acc.passages.length > 0 ? `\n\n${composeKnowledgeReply(acc.passages, tenant.language)}` : "";
    return { text: `لقيت أكتر من منتج قريب:\n${options}\nأنهي واحد تقصد؟${extra}`, toolsUsed };
  }

  // Pin product: top candidate or prior
  let product = acc.product;
  const pinnedId = product?.id ?? top?.id ?? args.priorProductId;
  if (!product && pinnedId && args.calls < args.maxCalls) {
    const res = await executeTool(tctx, "get_product", { product_id: pinnedId });
    toolsUsed.push("get_product");
    if (res.success) product = res.data as never;
  }
  if (!product) {
    return { text: `تحب توضح أكتر؟ لقيت: ${acc.candidates.slice(0, 3).map((c) => c.nameAr ?? c.name).join("، ")}`, toolsUsed };
  }

  // Size advice ("which size should I take?"): rank from the real table,
  // present as a suggestion, always confirm. Never invent numbers.
  if (isSizeAdvice(userText)) {
    const metrics = extractBodyMetrics(userText);
    const res = await executeTool(tctx, "recommend_size", {
      product_id: product.id,
      ...(metrics.chestCm != null ? { chest_cm: metrics.chestCm } : {}),
      ...(metrics.heightCm != null ? { height_cm: metrics.heightCm } : {}),
      ...(metrics.weightKg != null ? { weight_kg: metrics.weightKg } : {}),
      ...(metrics.fit ? { fit: metrics.fit } : {}),
    });
    toolsUsed.push("recommend_size");
    await prisma.conversation.update({ where: { id: args.conversationId }, data: { orderState: "VARIANT_SELECTION" } });
    let known = "";
    if (tctx.customerId) {
      const cust = await prisma.customer.findFirst({ where: { id: tctx.customerId, tenantId: args.tenantId }, select: { preferredSize: true } });
      if (cust?.preferredSize) known = `\n\nمسجل عندي إن مقاسك ${cust.preferredSize} — تحب نكمل بيه؟`;
    }
    if (res.success) {
      const d = res.data as {
        recommendations: Array<{ size: string; reason: string }>;
        method: string;
        confidence: string;
        table?: Array<{ size: string; chest: number | null; length: number | null }>;
      };
      if (d.recommendations.length > 0) {
        const [best, ...alts] = d.recommendations;
        const caveat = d.confidence === "low" ? " (ترشيح تقريبي — الأكيد بمحيط الصدر)" : "";
        const altTxt = alts.length > 0 ? `\nبدائل: ${alts.map((a) => `${a.size} (${a.reason})`).join("، ")}` : "";
        return { text: `أرشحلك مقاس ${best.size}${caveat}: ${best.reason}.${altTxt}\nأثبتهولك؟${known}`, toolsUsed };
      }
      const tableTxt = (d.table ?? []).map((r) => `${r.size}${r.chest != null ? ` (صدر ${r.chest}سم)` : ""}`).join("، ");
      return {
        text: tableTxt
          ? `جدول مقاسات ${product.name_ar ?? product.name}: ${tableTxt}.\nقولي محيط صدرك بالسم (أو طولك ووزنك) وأرشحلك بالظبط.${known}`
          : `مفيش جدول مقاسات مسجل لـ${product.name_ar ?? product.name} حالياً. قولي طولك ووزنك وأحاول أساعدك، أو أحوّلك لحد من الفريق؟`,
        toolsUsed,
      };
    }
  }

  const variants = product.variants.filter((v) => v.active);
  const inStock = variants.filter((v) => v.stock > 0);
  if (inStock.length === 0) {
    await prisma.conversation.update({ where: { id: args.conversationId }, data: { orderState: "PRODUCT_IDENTIFIED" } });
    return { text: `للأسف ${product.name_ar ?? product.name} خلصان حالياً من كل المقاسات والألوان. تحب أحوّلك لحد من الفريق يقترح بديل؟`, toolsUsed, escalated: false };
  }

  // Extract requested color/size/qty from message (customer content = untrusted, only entities)
  const wantColor = normalizeColorToken(userText);
  const wantSize = normalizeSizeToken(userText);
  const wantQty = extractQuantity(userText) ?? 1;

  // Single-variant fast path (e.g. quick-added "One Size" products): skip the
  // color/size interrogation entirely. An explicitly requested color/size that
  // contradicts the only variant is still refused — never silently substituted.
  let fastVariant: (typeof inStock)[number] | null = null;
  let sizeNote = "";
  if (inStock.length === 1) {
    const only = inStock[0];
    const onlyColor = only.attributes.Color ?? only.attributes.color;
    const onlySize = only.attributes.Size ?? only.attributes.size;
    if (wantColor && onlyColor && wantColor !== onlyColor) {
      return { text: `اللون ده مش متوفر في ${product.name_ar ?? product.name}. المتاح: ${onlyColor} بس.`, toolsUsed };
    }
    if (wantSize && onlySize && wantSize !== onlySize && onlySize !== "One Size") {
      return { text: `مقاس ${wantSize} مش متوفر. المتاح: ${onlySize} بس.`, toolsUsed };
    }
    if (wantSize && onlySize === "One Size") {
      sizeNote = " (المقاس One Size — مقاس واحد)";
    }
    fastVariant = only;
  }

  const colorsAvail = !fastVariant
    ? [...new Set(inStock.map((v) => v.attributes.Color ?? v.attributes.color).filter(Boolean))]
    : [];

  if (!fastVariant && wantColor && !colorsAvail.includes(wantColor)) {
    return { text: `اللون ده مش متوفر في ${product.name_ar ?? product.name}. المتاح: ${colorsAvail.join("، ")}. تحب أنهو لون؟`, toolsUsed };
  }
  if (!fastVariant && !wantColor && colorsAvail.length > 1 && !args.priorProductId) {
    await prisma.conversation.update({ where: { id: args.conversationId }, data: { orderState: "VARIANT_SELECTION" } });
    return {
      text: `أيوه، ${product.name_ar ?? product.name} بـ${product.base_price} ${cur}. متوفر بـ${colorsAvail.join(" و")}. تحب أي لون؟`,
      toolsUsed,
    };
  }
  // Outside the fast path a request without an explicit color pins the first
  // available one (before color interrogation only happens for new products).
  const color = wantColor ?? colorsAvail[0];

  const sizesForColor = !fastVariant
    ? inStock.filter((v) => (v.attributes.Color ?? v.attributes.color) === color).map((v) => v.attributes.Size ?? v.attributes.size)
    : [];
  if (!fastVariant && !wantSize) {
    await prisma.conversation.update({ where: { id: args.conversationId }, data: { orderState: "VARIANT_SELECTION" } });
    const colTxt = color ? `${color} ` : "";
    // Price question ("بكام؟") must be answered with the verified price now.
    const priceTxt = /بكام|بكم|سعر|price|cost|how much/i.test(userText) ? `بـ${product.base_price} ${cur}. ` : "";
    return { text: `${priceTxt}${colTxt}موجود. تحب أي مقاس؟ المتاح: ${sizesForColor.join("، ")}`, toolsUsed };
  }
  const found = fastVariant ?? inStock.find(
    (v) => (v.attributes.Color ?? v.attributes.color) === color && (v.attributes.Size ?? v.attributes.size) === wantSize
  );
  if (!found) {
    // invalid size for color -> list valid + alternatives
    const anySize = inStock.filter((v) => (v.attributes.Size ?? v.attributes.size) === wantSize);
    if (anySize.length > 0) {
      const altColors = [...new Set(anySize.map((v) => v.attributes.Color ?? v.attributes.color))];
      return { text: `مقاس ${wantSize} خلصان في ${color}، لكن متوفر في: ${altColors.join("، ")}. تحب لون منهم؟`, toolsUsed };
    }
    return { text: `مقاس ${wantSize} مش متوفر. المقاسات المتاحة في ${color}: ${sizesForColor.join("، ")}`, toolsUsed };
  }
  const variant = found;

  // Live inventory re-check (never trust earlier reads for the final answer)
  if (args.calls < args.maxCalls) {
    const chk = await executeTool(tctx, "check_inventory", { variant_id: variant.variant_id, quantity: wantQty });
    toolsUsed.push("check_inventory");
    if (chk.success) {
      const d = chk.data as { available: number; in_stock: boolean };
      if (!d.in_stock) {
        return { text: `للأسف ${variant.label} الكمية المتاحة ${d.available} بس. تحب تاخد المتاح ولا أرشحلك مقاس تاني؟`, toolsUsed };
      }
    }
  }

  // Create/update draft then ask for delivery info + confirmation
  const zone = args.tenant.deliveryZones[0];
  const draftRes = await executeTool(tctx, "create_order_draft", {
    lines: [{ variant_id: variant.variant_id, quantity: wantQty }],
    delivery_zone_id: zone?.id,
    payment_method: "CASH_ON_DELIVERY",
    idempotency_key: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
  });
  toolsUsed.push("create_order_draft");
  if (!draftRes.success) {
    return { text: `مقدرتش أجهز الأوردر دلوقتي (${draftRes.error?.message ?? ""}). هحوّلك لحد من الفريق.`, toolsUsed, escalated: true };
  }
  const dd = draftRes.data as { subtotal: number; discount?: number; delivery_fee: number; total: number; applied_promos?: string[] };
  let extra = "";
  if (args.acc.passages.length > 0) extra = `\n\nملحوظة: ${args.acc.passages[0].content.slice(0, 300)}`;
  await prisma.conversation.update({ where: { id: args.conversationId }, data: { orderState: "CUSTOMER_CONFIRMATION" } });

  const label = variant.label || variantLabel(variant.attributes);
  const photo = product.images?.[0]?.url;
  const discountLine = dd.discount && dd.discount > 0 ? `خصم ${dd.discount} ${cur}${dd.applied_promos?.length ? ` (${dd.applied_promos.join("، ")})` : ""}\n` : "";
  return {
    text:
      `الأوردر:\n\n${product.name_ar ?? product.name} — ${label} — ×${wantQty}${sizeNote}\n` +
      `${dd.subtotal} ${cur}\n${discountLine}الشحن ${dd.delivery_fee} ${cur}\nالإجمالي ${dd.total} ${cur}\n\n` +
      `ابعتلي الاسم والعنوان عشان أظبط التوصيل، وأأكد الأوردر؟${extra}`,
    toolsUsed,
    ...(photo ? { image: { url: photo } } : {}),
  };
}
