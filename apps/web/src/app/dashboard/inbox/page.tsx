"use client";
import { useEffect, useRef, useState, useMemo } from "react";
import { Loading, Err, Empty, StatusBadge, timeAgo } from "@/components/ui";
import { toast } from "@/components/Toast";

const CHANNEL_LABEL: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  WEBSITE: "Website",
  SIMULATOR: "Test chat",
  INSTAGRAM: "Instagram",
  MESSENGER: "Messenger",
  TELEGRAM: "Telegram",
};

const STATE_LABEL: Record<string, string> = {
  DISCOVERY: "Browsing",
  PRODUCT_IDENTIFIED: "Product found",
  VARIANT_SELECTION: "Choosing variant",
  QUANTITY_SELECTION: "Quantity",
  CUSTOMER_INFORMATION: "Details",
  DELIVERY_SELECTION: "Delivery",
  PAYMENT_SELECTION: "Payment",
  ORDER_REVIEW: "Review",
  CUSTOMER_CONFIRMATION: "Confirming",
  ORDER_CREATED: "Ordered",
};

const ROLE_LABEL: Record<string, string> = {
  customer: "Customer",
  assistant: "AI Assistant",
  human_agent: "Team",
  system: "System",
};

const CHANNEL_DOT: Record<string, string> = {
  WHATSAPP: "bg-green-600",
  WEBSITE: "bg-sky-600",
  SIMULATOR: "bg-amber-500",
  INSTAGRAM: "bg-pink-600",
  MESSENGER: "bg-blue-600",
  TELEGRAM: "bg-cyan-600",
};

interface ThreadMessage {
  role: string;
  content: string;
  createdAt: string;
  error?: string | null;
  providerMessageId?: string | null;
}

interface Convo {
  id: string; channel: string; status: string; orderState: string; lastMessageAt: string;
  customer?: { name?: string | null; phone?: string | null } | null;
  messages?: Array<{ content: string }>;
}

export default function Inbox() {
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [list, setList] = useState<Convo[] | null>(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState<(Convo & { messagesFull?: ThreadMessage[] }) | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const params = new URLSearchParams();
      if (filter) params.set("status", filter);
      if (search) params.set("q", search);
      const r = await fetch(`/api/conversations?${params.toString()}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j?.error?.message);
      setList(j.data.conversations);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }
  useEffect(() => { load(); }, [filter, search]);

  async function open(id: string) {
    const r = await fetch(`/api/conversations/${id}`);
    const j = await r.json();
    if (j.ok) setActive({ ...j.data.conversation, messagesFull: j.data.conversation.messages });
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [active?.messagesFull?.length, active?.id]);

  async function send(takeover: boolean) {
    if (!active || !reply.trim() || sending) return;
    setSending(true);
    try {
      if (takeover) await fetch(`/api/conversations/${active.id}/takeover`, { method: "POST" });
      await fetch(`/api/conversations/${active.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: reply }),
      });
      setReply("");
      await open(active.id);
      await load();
      toast({ type: "success", title: "Message sent" });
    } catch {
      toast({ type: "error", title: "Failed to send message" });
    } finally {
      setSending(false);
    }
  }

  async function setStatus(status: string) {
    if (!active) return;
    const r = await fetch(`/api/conversations/${active.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    });
    if (r.ok) {
      await open(active.id);
      await load();
      toast({ type: "success", title: `Conversation ${status === "RESOLVED" ? "resolved" : "updated"}` });
    } else {
      toast({ type: "error", title: "Failed to update status" });
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd/Ctrl + K: focus search
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      // Escape: close active conversation
      if (e.key === "Escape" && active) {
        setActive(null);
      }
      // N: new conversation (focus search)
      if (e.key === "n" && !active && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      // R: reply (focus reply input)
      if (e.key === "r" && active && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        const replyInput = document.querySelector('input[aria-label="Reply message"]') as HTMLInputElement;
        replyInput?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [active]);

  // Filter conversations by search term
  const filteredList = useMemo(() => {
    if (!list) return [];
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter((c) =>
      c.customer?.name?.toLowerCase().includes(q) ||
      c.customer?.phone?.includes(q) ||
      c.messages?.[0]?.content.toLowerCase().includes(q)
    );
  }, [list, search]);

  if (error) return <Err message={error} />;
  if (!list) return <Loading label="Loading inbox…" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-extrabold tracking-tight">Inbox</h1>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input
              ref={searchInputRef}
              className="input w-64 pl-10"
              placeholder="Search conversations…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search conversations"
            />
          </div>
          <select className="input w-48" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter conversations">
            <option value="">All</option>
            <option value="AI_ACTIVE">AI active</option>
            <option value="HUMAN_REQUIRED">Needs human</option>
            <option value="HUMAN_ACTIVE">Human active</option>
            <option value="RESOLVED">Resolved</option>
          </select>
        </div>
      </div>
      {filteredList.length === 0 && list?.length === 0 && <Empty title="No conversations yet" hint="New customer messages will appear here in real time." />}
      {filteredList.length === 0 && list?.length > 0 && (
        <Empty title="No matching conversations" hint="Try adjusting your search or filter." />
      )}
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="card divide-y divide-ink-100 overflow-hidden" role="list">
          {filteredList.map((c) => (
            <button
              key={c.id}
              onClick={() => open(c.id)}
              role="listitem"
              className={`block w-full px-4 py-3 text-left hover:bg-ink-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-600 ${active?.id === c.id ? "bg-brand-50" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${CHANNEL_DOT[c.channel] ?? "bg-ink-300"}`} title={CHANNEL_LABEL[c.channel] ?? c.channel} />
                  <span className="truncate">{c.customer?.name ?? c.customer?.phone ?? "Unknown"}</span>
                </span>
                <StatusBadge status={c.status} />
              </div>
              <div className="mt-0.5 truncate text-xs text-ink-500" dir="auto">{c.messages?.[0]?.content ?? "—"}</div>
              <div className="mt-1 text-[11px] text-ink-300">{CHANNEL_LABEL[c.channel] ?? c.channel} · {timeAgo(c.lastMessageAt)}</div>
            </button>
          ))}
        </div>
        <div className="card flex min-h-[480px] flex-col">
          {!active && <div className="p-10 text-center text-sm text-ink-500">Select a conversation.</div>}
          {active && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-2 text-sm">
                <span className="font-semibold">
                  {active.customer?.name ?? active.customer?.phone ?? "Unknown"}
                  <span className="ml-2 font-normal text-ink-500">
                    {CHANNEL_LABEL[active.channel] ?? active.channel} · {STATE_LABEL[active.orderState] ?? active.orderState}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <StatusBadge status={active.status} />
                  {active.status !== "AI_ACTIVE" && (
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setStatus("AI_ACTIVE")}>Resume AI</button>
                  )}
                  {active.status !== "RESOLVED" && (
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setStatus("RESOLVED")}>Resolve</button>
                  )}
                </span>
              </div>
              <div ref={scrollRef} className="chat-scroll max-h-[520px] flex-1 space-y-2 overflow-y-auto p-4">
                {(active.messagesFull ?? []).map((m, i) => (
                  <div key={i} className={`flex ${m.role === "customer" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.role === "customer" ? "bg-ink-900 text-white" : m.role === "human_agent" ? "border border-brand-100 bg-brand-50" : "border border-ink-100"}`}>
                      <div className="mb-0.5 text-[11px] font-medium opacity-60">
                        {m.role === "customer" ? (active.customer?.name ?? "Customer") : (ROLE_LABEL[m.role] ?? m.role)}
                      </div>
                      <div dir="auto" className="whitespace-pre-line">{m.content}</div>
                      <div className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-50">
                        <span>{new Date(m.createdAt).toLocaleString()}</span>
                        {m.role !== "customer" && (m.error
                          ? <span className="font-semibold text-red-600" title={m.error}>⚠ not delivered</span>
                          : <span title="Sent">✓✓</span>)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 border-t border-ink-100 p-3">
                <input
                  className="input"
                  placeholder={active.status === "AI_ACTIVE" ? "Reply as human (takes over)…" : "Reply as team…"}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) send(active.status === "AI_ACTIVE"); }}
                  aria-label="Reply message"
                />
                <button className="btn-primary" onClick={() => send(active.status === "AI_ACTIVE")} disabled={sending}>
                  {active.status === "AI_ACTIVE" ? "Take over & send" : "Send"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
