import { config } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { LLMProvider, LlmToolCall, LlmTurn, ToolDef } from "./llm";

/**
 * Provider layer for OpenAI-compatible chat-completions APIs
 * (OpenRouter, OpenCode Zen, plain OpenAI).
 *
 * Docs consulted:
 * - OpenRouter: POST https://openrouter.ai/api/v1/chat/completions,
 *   Bearer key, optional HTTP-Referer / X-Title, OpenAI-style
 *   `tools`+`tool_calls`, `usage` tokens. Model catalog is volatile —
 *   models are env-configured, never hard-coded into call sites.
 * - OpenCode Zen: POST https://opencode.ai/zen/v1/chat/completions,
 *   Bearer key, OpenAI-compatible (`@ai-sdk/openai-compatible`).
 *
 * Failure model: every failure is classified. Same-provider retry happens
 * at most LLM_MAX_RETRIES times and only for retryable kinds; the composite
 * chain then moves to the next candidate exactly once. No infinite loops.
 */

export type ProviderErrorKind =
  | "timeout"
  | "rate_limited"
  | "server"
  | "bad_request"
  | "auth"
  | "model_not_found"
  | "network"
  | "malformed";

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  /** Same request may be retried on the SAME provider. */
  readonly retryable: boolean;
  /** Moving to the NEXT provider candidate may help. */
  readonly fallback: boolean;
  readonly status?: number;

  constructor(kind: ProviderErrorKind, message: string, opts?: { retryable?: boolean; fallback?: boolean; status?: number }) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.retryable = opts?.retryable ?? false;
    this.fallback = opts?.fallback ?? true;
    this.status = opts?.status;
  }
}

export type TaskKind = "agent" | "simple" | "extract" | "complex" | "rag";

/** Task -> model routing. Per-task env override, else primary LLM_MODEL. */
export function resolveTaskModel(task: TaskKind): string {
  const per: Record<TaskKind, string> = {
    agent: config.llm.taskModels.agent,
    simple: config.llm.taskModels.simple,
    extract: config.llm.taskModels.extract,
    complex: config.llm.taskModels.complex,
    rag: config.llm.taskModels.rag,
  };
  return per[task] || config.llm.model;
}

export interface OpenAICompatibleOptions {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  extraHeaders?: Record<string, string>;
}

interface WireToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string | Record<string, unknown> };
}

function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw) as unknown;
      return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  readonly model: string;
  protected readonly baseUrl: string;
  protected readonly apiKey: string;
  protected readonly extraHeaders: Record<string, string>;

  constructor(opts: OpenAICompatibleOptions) {
    this.name = opts.name;
    this.model = opts.model;
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.extraHeaders = opts.extraHeaders ?? {};
  }

  async generate(args: {
    system: string;
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    tools: ToolDef[];
    maxToolCalls: number;
    task?: TaskKind;
  }): Promise<LlmTurn> {
    const model = args.task ? resolveTaskModel(args.task) : this.model;
    const maxAttempts = 1 + Math.max(0, Math.min(2, config.llm.maxRetries));
    let last: ProviderError | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const turn = await this.requestOnce({ ...args, model });
        return { ...turn, provider: this.name, model };
      } catch (err) {
        const pe = err instanceof ProviderError ? err : new ProviderError("network", "Provider request failed", { retryable: true });
        last = pe;
        if (!pe.retryable || attempt >= maxAttempts) throw pe;
        await sleep(Math.min(8000, 400 * 2 ** (attempt - 1)));
      }
    }
    throw last ?? new ProviderError("network", "Provider request failed", { retryable: true });
  }

  protected async requestOnce(args: {
    system: string;
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    tools: ToolDef[];
    maxToolCalls: number;
    model: string;
  }): Promise<LlmTurn> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.llm.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...this.extraHeaders,
        },
        body: JSON.stringify({
          model: args.model,
          temperature: config.llm.temperature,
          max_tokens: config.llm.maxTokens,
          messages: [
            { role: "system", content: args.system },
            ...args.messages.map((m) => ({ role: m.role, content: m.content })),
          ],
          tools: args.tools.map((t) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
          tool_choice: "auto",
        }),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new ProviderError("timeout", `LLM timeout after ${config.llm.timeoutMs}ms`, { retryable: true });
      }
      throw new ProviderError("network", "LLM network error", { retryable: true });
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "0");
      if (Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 10) await sleep(retryAfter * 1000);
      throw new ProviderError("rate_limited", "LLM rate limit (429)", { retryable: true, status: 429 });
    }
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError("auth", `LLM auth rejected (${res.status})`, { retryable: false, status: res.status });
    }
    if (res.status === 404) {
      throw new ProviderError("model_not_found", "LLM model not found (404)", { retryable: false, status: 404 });
    }
    if (res.status === 400) {
      const body = await res.text().catch(() => "");
      throw new ProviderError("bad_request", `LLM rejected request (400): ${body.slice(0, 200)}`, {
        retryable: false,
        status: 400,
      });
    }
    if (res.status >= 500) {
      throw new ProviderError("server", `LLM server error (${res.status})`, { retryable: true, status: res.status });
    }
    if (!res.ok) {
      throw new ProviderError("server", `LLM request failed (${res.status})`, { retryable: true, status: res.status });
    }

    let data: {
      choices?: Array<{
        message?: { content?: string | Array<{ type?: string; text?: string }>; tool_calls?: WireToolCall[] };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number };
    };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      throw new ProviderError("malformed", "LLM returned non-JSON", { retryable: true });
    }
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new ProviderError("malformed", "LLM returned no choices", { retryable: true });

    const text =
      typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((p) => (typeof p === "string" ? p : (p.text ?? ""))).join("")
          : undefined;

    const toolCalls: LlmToolCall[] = (msg.tool_calls ?? [])
      .filter((c) => c?.function?.name)
      .slice(0, args.maxToolCalls)
      .map((c, i) => ({
        id: c.id ?? `tc_${Date.now()}_${i}`,
        name: c.function!.name!,
        arguments: parseToolArguments(c.function!.arguments),
      }));

    return {
      text: text || undefined,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
      costEstimate: typeof data.usage?.cost === "number" ? data.usage.cost : undefined,
    };
  }
}

/** OpenRouter gateway (https://openrouter.ai/api/v1). Key: OPENROUTER_API_KEY. */
export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(model?: string) {
    super({
      name: "openrouter",
      baseUrl: config.llm.openrouter.baseUrl,
      apiKey: config.llm.openrouter.apiKey,
      model: model ?? config.llm.model,
      extraHeaders: {
        "HTTP-Referer": config.appUrl,
        "X-Title": "YASEZ Commerce",
      },
    });
  }
}

/** OpenCode Zen gateway (https://opencode.ai/zen/v1). Key: OPENCODE_API_KEY. */
export class OpenCodeProvider extends OpenAICompatibleProvider {
  constructor(model?: string) {
    super({
      name: "opencode",
      baseUrl: config.llm.opencode.baseUrl,
      apiKey: config.llm.opencode.apiKey,
      model: model ?? config.llm.opencode.model,
    });
  }
}

export interface Candidate {
  provider: "openrouter" | "opencode";
  model: string;
  hasKey: boolean;
}

/**
 * Fallback chain: OpenRouter primary -> OpenRouter fallback model ->
 * OpenCode -> throw (caller escalates safely). Each candidate is tried at
 * most (1 + maxRetries) times and only for retryable errors; client errors
 * (auth/bad request/unknown model) skip retries but still allow ONE attempt
 * at the next candidate since the failure may be provider-specific.
 * Terminal: the agent catches the throw and replies safely + escalates.
 */
export class CompositeLLMProvider implements LLMProvider {
  readonly name = "composite";
  readonly model: string;
  private readonly candidates: Candidate[];
  private readonly factory: (c: Candidate) => OpenAICompatibleProvider;

  constructor(task: TaskKind = "agent", factory?: (c: Candidate) => OpenAICompatibleProvider, candidatesOverride?: Candidate[]) {
    const primary = resolveTaskModel(task);
    const fallbackModel = config.llm.fallbackModel;
    const list: Candidate[] =
      candidatesOverride ?? [
        { provider: "openrouter", model: primary, hasKey: Boolean(config.llm.openrouter.apiKey) },
        { provider: "openrouter", model: fallbackModel, hasKey: Boolean(config.llm.openrouter.apiKey) && fallbackModel !== primary },
        { provider: "opencode", model: config.llm.opencode.model, hasKey: Boolean(config.llm.opencode.apiKey) },
      ];
    // Dedupe identical (provider, model); drop keyless candidates.
    const seen = new Set<string>();
    this.candidates = list.filter((c) => {
      if (!c.hasKey) return false;
      const k = `${c.provider}:${c.model}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    this.factory =
      factory ??
      ((c) => (c.provider === "openrouter" ? new OpenRouterProvider(c.model) : new OpenCodeProvider(c.model)));
    this.model = this.candidates[0]?.model ?? "none";
  }

  get chain(): string[] {
    return this.candidates.map((c) => `${c.provider}:${c.model}`);
  }

  async generate(args: {
    system: string;
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    tools: ToolDef[];
    maxToolCalls: number;
    task?: TaskKind;
  }): Promise<LlmTurn> {
    let lastError: unknown = null;
    let depth = 0;
    for (const c of this.candidates) {
      const started = Date.now();
      const provider = this.factory(c);
      try {
        const turn = await provider.generate(args);
        logger.info("llm candidate succeeded", {
          provider: turn.provider ?? c.provider,
          model: turn.model ?? c.model,
          fallbackDepth: depth,
          latencyMs: Date.now() - started,
          inputTokens: turn.inputTokens,
          outputTokens: turn.outputTokens,
        });
        return turn;
      } catch (err) {
        const kind = err instanceof ProviderError ? err.kind : "unknown";
        // Never log keys/headers/bodies — kind + status are enough.
        logger.warn("llm candidate failed", {
          provider: c.provider,
          model: c.model,
          fallbackDepth: depth,
          errorKind: kind,
          latencyMs: Date.now() - started,
        });
        depth++;
        lastError = err;
        const pe = err instanceof ProviderError ? err : null;
        // Bad-request/auth/model errors: no same-provider retry, but the
        // next candidate (different key/backend) still gets one attempt.
        if (pe && !pe.fallback) break;
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw new ProviderError("network", "No LLM provider configured", { retryable: false, fallback: false });
  }
}
