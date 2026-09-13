import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import {
  CompositeLLMProvider,
  OpenCodeProvider,
  OpenRouterProvider,
  ProviderError,
  resolveTaskModel,
} from "./providers";

const TOOLS = [{ name: "search_products", description: "s", parameters: { type: "object" } }];
const MSGS = [{ role: "user" as const, content: "hi" }];

function okBody(over: Record<string, unknown> = {}) {
  return {
    choices: [{ message: { content: "hello", tool_calls: [] } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
    ...over,
  };
}

function resp(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const origFetch = globalThis.fetch;

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  globalThis.fetch = origFetch;
  vi.unstubAllGlobals();
});

describe("OpenAICompatible provider wire format", () => {
  it("sends OpenAI-style body and parses tool_calls + usage", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        seen.push({ url, init });
        return resp(200, {
          choices: [
            { message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "search_products", arguments: '{"query":"tshirt"}' } }] } },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        });
      })
    );
    const p = new OpenRouterProvider("test-model");
    const turn = await p.generate({ system: "sys", messages: MSGS, tools: TOOLS, maxToolCalls: 8 });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const headers = seen[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ");
    expect(headers["HTTP-Referer"]).toBeTruthy();
    expect(headers["X-Title"]).toBe("YASEZ Commerce");
    const body = JSON.parse(seen[0].init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ model: "test-model", tool_choice: "auto" });
    expect(typeof body.max_tokens).toBe("number");
    expect(turn.toolCalls?.[0]).toMatchObject({ id: "c1", name: "search_products", arguments: { query: "tshirt" } });
    expect(turn.inputTokens).toBe(100);
    expect(turn.provider).toBe("openrouter");
    expect(turn.model).toBe("test-model");
  });

  it("accepts tool arguments as objects and caps tool calls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        resp(200, {
          choices: [
            {
              message: {
                content: "x",
                tool_calls: [1, 2, 3].map((i) => ({ id: `c${i}`, function: { name: "search_products", arguments: { query: "a" } } })),
              },
            },
          ],
        })
      )
    );
    const p = new OpenCodeProvider("m");
    const turn = await p.generate({ system: "s", messages: MSGS, tools: TOOLS, maxToolCalls: 2 });
    expect(turn.toolCalls).toHaveLength(2);
    expect(turn.toolCalls?.[0].arguments).toEqual({ query: "a" });
  });

  it("retries once on 429 then succeeds", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n++;
        return n === 1 ? resp(429, { error: "slow down" }) : resp(200, okBody());
      })
    );
    const turn = await new OpenRouterProvider("m").generate({ system: "s", messages: MSGS, tools: TOOLS, maxToolCalls: 8 });
    expect(n).toBe(2);
    expect(turn.text).toBe("hello");
  });

  it("classifies 500 as retryable server error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(500, { error: "boom" })));
    await expect(new OpenRouterProvider("m").generate({ system: "s", messages: MSGS, tools: TOOLS, maxToolCalls: 8 })).rejects.toMatchObject({
      kind: "server",
      retryable: true,
    });
  });

  it("classifies 401/400/404 as non-retryable", async () => {
    for (const [status, kind] of [[401, "auth"], [400, "bad_request"], [404, "model_not_found"]] as const) {
      const calls: unknown[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (...a: unknown[]) => {
          calls.push(a);
          return resp(status, { error: "nope" });
        })
      );
      const err = await new OpenRouterProvider("m").generate({ system: "s", messages: MSGS, tools: TOOLS, maxToolCalls: 8 }).catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.kind).toBe(kind);
      expect(err.retryable).toBe(false);
      expect(err.fallback).toBe(true);
      expect(calls).toHaveLength(1); // no same-provider retry for client errors
    }
  });

  it("classifies timeout and malformed responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        throw e;
      })
    );
    await expect(new OpenRouterProvider("m").generate({ system: "s", messages: MSGS, tools: TOOLS, maxToolCalls: 8 })).rejects.toMatchObject({ kind: "timeout" });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("not-json", { status: 200 })));
    await expect(new OpenRouterProvider("m").generate({ system: "s", messages: MSGS, tools: TOOLS, maxToolCalls: 8 })).rejects.toMatchObject({ kind: "malformed" });

    vi.stubGlobal("fetch", vi.fn(async () => resp(200, { choices: [] })));
    await expect(new OpenRouterProvider("m").generate({ system: "s", messages: MSGS, tools: TOOLS, maxToolCalls: 8 })).rejects.toMatchObject({ kind: "malformed" });
  });
});

describe("Composite fallback chain", () => {
  const ARGS = { system: "s", messages: MSGS, tools: TOOLS, maxToolCalls: 8 };

  function flaky(failures: Array<"server" | "auth" | "timeout">, text = "fallback-ok") {
    let n = 0;
    return {
      name: "stub",
      model: "stub-model",
      generate: async () => {
        const kind = failures[n++];
        if (kind === "server") throw new ProviderError("server", "down", { retryable: true });
        if (kind === "auth") throw new ProviderError("auth", "bad key", { retryable: false });
        if (kind === "timeout") throw new ProviderError("timeout", "slow", { retryable: true });
        return { text, provider: "stub", model: "stub-model" };
      },
    };
  }

  it("moves to the next candidate after retryable failure", async () => {
    const c = new CompositeLLMProvider(
      "agent",
      (cand) =>
        (cand.model === "primary"
          ? flaky(["server", "server"])
          : flaky([])) as never,
      [
        { provider: "openrouter", model: "primary", hasKey: true },
        { provider: "opencode", model: "fallback", hasKey: true },
      ]
    );
    const turn = await c.generate(ARGS);
    expect(turn.text).toBe("fallback-ok");
    expect(turn.provider).toBe("stub");
  });

  it("still tries the next provider after auth failure (different key)", async () => {
    const c = new CompositeLLMProvider(
      "agent",
      (cand) => (cand.provider === "openrouter" ? flaky(["auth"]) : flaky([])) as never,
      [
        { provider: "openrouter", model: "primary", hasKey: true },
        { provider: "opencode", model: "fallback", hasKey: true },
      ]
    );
    const turn = await c.generate(ARGS);
    expect(turn.text).toBe("fallback-ok");
  });

  it("throws the last error when every candidate fails (caller escalates)", async () => {
    const c = new CompositeLLMProvider("agent", () => flaky(["server", "server", "server"]) as never, [
      { provider: "openrouter", model: "a", hasKey: true },
      { provider: "opencode", model: "b", hasKey: true },
    ]);
    await expect(c.generate(ARGS)).rejects.toMatchObject({ kind: "server" });
  });

  it("empty chain (no keys) fails closed without network calls", async () => {
    const spy = vi.fn(async () => resp(200, okBody()));
    vi.stubGlobal("fetch", spy);
    const c = new CompositeLLMProvider("agent");
    expect(c.chain).toEqual([]);
    await expect(c.generate(ARGS)).rejects.toMatchObject({ kind: "network" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("task model resolution falls back to primary", () => {
    expect(typeof resolveTaskModel("simple")).toBe("string");
    expect(resolveTaskModel("simple").length).toBeGreaterThan(0);
  });
});
