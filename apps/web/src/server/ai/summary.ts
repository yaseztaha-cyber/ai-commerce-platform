/**
 * Deterministic conversation summarization (no LLM cost, bounded size).
 * Summaries NEVER replace authoritative DB state (drafts, orders, stock) —
 * they only give the model cheap continuity for long conversations.
 * History sent to the model is always capped (last N messages + this summary).
 */

export interface HistoryEntry {
  role: string;
  content: string;
  toolCalls?: unknown;
}

export function buildConversationSummary(history: HistoryEntry[]): string {
  if (history.length === 0) return "";
  const customers = history.filter((m) => m.role === "customer").length;
  const assistants = history.filter((m) => m.role !== "customer").length;

  const products = new Set<string>();
  const tools = new Map<string, number>();
  for (const m of history) {
    const tc = m.toolCalls as Array<{ name?: unknown; arguments?: unknown }> | null | undefined;
    if (Array.isArray(tc)) {
      for (const c of tc) {
        if (c && typeof c.name === "string") tools.set(c.name, (tools.get(c.name) ?? 0) + 1);
        const args = c?.arguments as Record<string, unknown> | undefined;
        const pid = args?.product_id ?? args?.productId;
        if (typeof pid === "string") products.add(pid.slice(-8));
      }
    }
  }
  const firstTopics = history
    .filter((m) => m.role === "customer")
    .slice(0, 2)
    .map((m) => m.content.slice(0, 80));
  const parts = [`${customers} customer / ${assistants} assistant messages`];
  if (products.size > 0) parts.push(`products discussed: ${[...products].join(", ")}`);
  const topTools = [...tools.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, k]) => `${n}×${k}`);
  if (topTools.length > 0) parts.push(`tools used: ${topTools.join(", ")}`);
  if (firstTopics.length > 0) parts.push(`opened with: ${firstTopics.join(" | ")}`);
  return parts.join("; ");
}

/** Should the turn include a summary? Keeps context bounded. */
export function needsSummary(historyLength: number): boolean {
  return historyLength > 12;
}
