import { config } from "@/lib/env";
import { isPromoQuestion } from "@ai-commerce/shared";
import { CompositeLLMProvider, OpenAICompatibleProvider } from "./providers";

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmTurn {
  text?: string;
  toolCalls?: LlmToolCall[];
  inputTokens?: number;
  outputTokens?: number;
  /** Actual provider/model that produced this turn (after fallback routing). */
  provider?: string;
  model?: string;
  costEstimate?: number;
}

/** LLM only understands language + chooses actions. Backend owns truth. */
export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  generate(args: {
    system: string;
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    tools: ToolDef[];
    maxToolCalls: number;
  }): Promise<LlmTurn>;
}

const TOOL_SCHEMAS_HINT = `
Available tools (call with JSON args):
- search_products {query}
- get_product {product_id}
- check_inventory {variant_id, quantity}
- get_delivery_options {}
- calculate_order {lines:[{variant_id,quantity}], delivery_zone_id?}
- create_order_draft {lines, customer_name?, customer_phone?, address?, delivery_zone_id?, payment_method?, idempotency_key}
- confirm_order {order_id, idempotency_key}
- get_order {order_id}
- search_business_knowledge {query}
- request_human {reason}
Reply format: one JSON object per line. {"tool":"NAME","args":{...}} or {"say":"..."}.
`.trim();

/**
 * Deterministic rule-based NLU engine (Arabic-first). Used when no LLM key
 * is configured and in tests. It performs intent extraction + tool planning
 * without hallucinating: every factual claim must come from a tool result.
 */
export class RuleBasedLLMProvider implements LLMProvider {
  readonly name = "rulebased";
  readonly model = "rulebased-v1";

  async generate(args: {
    system: string;
    messages: Array<{ role: string; content: string }>;
    tools: ToolDef[];
  }): Promise<LlmTurn> {
    const lastUser = [...args.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const ctx = this.parseContext(args.system);
    const plan = this.plan(lastUser, ctx);
    return {
      text: plan.say ?? undefined,
      toolCalls: plan.calls,
      inputTokens: 0,
      outputTokens: 0,
      provider: this.name,
      model: this.model,
    };
  }

  private parseContext(system: string): {
    productId?: string;
    orderState?: string;
    draftId?: string;
    pendingQuestion?: string;
  } {
    try {
      const m = system.match(/\[CTX\]([\s\S]*?)\[\/CTX\]/);
      if (!m) return {};
      return JSON.parse(m[1]) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private plan(userText: string, ctx: { productId?: string; draftId?: string }): { calls: LlmToolCall[]; say?: string } {
    const t = userText.trim();
    const calls: LlmToolCall[] = [];
    const id = (n: string) => `rb_${n}_${Math.random().toString(36).slice(2, 7)}`;

    // 1. Human request -> escalate immediately
    if (/عايز اكلم|عاوز اكلم|كلم.*حد|انسان|موظف|خدمة العملاء|talk to|human|real person|support agent/i.test(t)) {
      calls.push({ id: id("h"), name: "request_human", arguments: { reason: t.slice(0, 200) } });
      return { calls };
    }

    // 2. Confirmation with existing draft -> confirm
    if (ctx.draftId && /^(اكد|أكد|تمام|ماشي|اوك|أوك|موافق|ايوه|أيوه|اه|آه|نعم|yes|yeah|ok|okay|confirm)/i.test(t.trim()) && t.length < 40) {
      calls.push({ id: id("c"), name: "confirm_order", arguments: { order_id: ctx.draftId, idempotency_key: ctx.draftId } });
      return { calls };
    }

    // 3. Knowledge/policy questions (no product intent) -> RAG
    if (/سياسه|سياسة|استبدال|استرجاع|استرجاع|شحن|توصيل.*(قد ايه|كام يوم|مدة)|دفع|ضمان|عنوان|مواعيد|دوام/i.test(t) && !/(تيشيرت|تيشرت|هودي|جينز|كارجو|بنطلون|سويت|tshirt|hoodie|jeans|مقاس|لون|اسود|ابيض|بيج)/i.test(t)) {
      calls.push({ id: id("k"), name: "search_business_knowledge", arguments: { query: t } });
      return { calls };
    }

    // 3.5 Offer/discount questions -> structured promos. With a product
    // mention, search products too so the order flow can apply them.
    if (isPromoQuestion(t)) {
      calls.push({ id: id("p"), name: "get_promotions", arguments: {} });
      if (/(تيشيرت|تيشرت|هودي|جينز|كارجو|بنطلون|سويت|tshirt|hoodie|jeans|جاكت|كاب|سكارف|محفظه|محفظة|فستان|قميص)/i.test(t)) {
        calls.push({ id: id("s"), name: "search_products", arguments: { query: t } });
      }
      return { calls };
    }

    // 4. Otherwise: search products (transactional path first)
    // Strip to likely product mention; keep full text as query for fuzzy match.
    calls.push({ id: id("s"), name: "search_products", arguments: { query: t } });
    void TOOL_SCHEMAS_HINT;
    return { calls };
  }
}

export function getLLMProvider(): LLMProvider {
  // Explicit rulebased (offline dev/tests) or no network keys at all.
  if (config.llm.provider === "rulebased") return new RuleBasedLLMProvider();
  const hasOpenRouter = Boolean(config.llm.openrouter.apiKey);
  const hasOpenCode = Boolean(config.llm.opencode.apiKey);
  if ((config.llm.provider === "openrouter" || config.llm.provider === "opencode" || config.llm.provider === "composite") && (hasOpenRouter || hasOpenCode)) {
    return new CompositeLLMProvider("agent");
  }
  // Legacy plain-OpenAI config maps onto the same hardened implementation.
  if (config.llm.provider === "openai" && config.llm.apiKey) {
    return new OpenAICompatibleProvider({ name: "openai", baseUrl: config.llm.baseUrl, apiKey: config.llm.apiKey, model: config.llm.model });
  }
  return new RuleBasedLLMProvider();
}
