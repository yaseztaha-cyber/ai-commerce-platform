"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "@/components/Toast";
import { Empty } from "@/components/ui";

interface Turn { from: "me" | "ai"; text: string; tools?: string[]; image?: string | null; at: number }

const SUGGESTIONS = [
  "عايز تيشيرت اوفرسايز اسود مقاس L",
  "بكام الهودي الاسود؟",
  "مدة الاستبدال كام؟",
  "عايز اكلم حد من خدمة العملاء",
  "عندكم خصم؟",
  "عايز قميص ازرق مقاس M",
  "أين طلبى رقم #1001؟",
  "عايز استبدال المنتج",
];

const STORAGE_KEY = "playground_history";

export default function Playground() {
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) return JSON.parse(stored);
      } catch { }
    }
    return [];
  });
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(turns));
  }, [turns]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, busy]);

  const clearHistory = useCallback(() => {
    setTurns([]);
    localStorage.removeItem(STORAGE_KEY);
    toast({ type: "info", title: "History cleared" });
  }, []);

  const copyToClipboard = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast({ type: "success", title: `${label} copied` }),
      () => toast({ type: "error", title: "Failed to copy" })
    );
  }, []);

  const openImage = useCallback((url: string) => {
    setImagePreview(url);
  }, []);

  async function send(text?: string) {
    const me = (text ?? input).trim();
    if (!me || busy) return;
    setBusy(true);
    setInput("");
    setTurns((t) => [...t, { from: "me", text: me, at: Date.now() }]);
    try {
      const r = await fetch("/api/ai/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: me }) });
      const j = await r.json();
      setTurns((t) => [...t, { from: "ai", text: j.ok ? j.data.reply : `Error: ${j?.error?.message ?? r.status}`, tools: j.ok ? j.data.toolsUsed : [], image: j.ok ? (j.data.image?.url ?? null) : null, at: Date.now() }]);
    } catch {
      setTurns((t) => [...t, { from: "ai", text: "Connection error — is the server running?", at: Date.now() }]);
    } finally {
      setBusy(false);
    }
  }

  const aiTurns = turns.filter(t => t.from === "ai");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-extrabold tracking-tight">AI Playground</h1>
          <span className="badge-amber">Test mode — writes test orders</span>
        </div>
        <div className="flex items-center gap-2">
          {turns.length > 0 && (
            <button onClick={clearHistory} className="btn-ghost text-xs" title="Clear conversation history">
              <svg aria-hidden="true" className="w-4 h-4 me-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              Clear
            </button>
          )}
          <button onClick={() => setShowHistory(!showHistory)} className="btn-ghost text-xs">
            <svg aria-hidden="true" className="w-4 h-4 me-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            {showHistory ? "Hide" : "History"}
          </button>
        </div>
      </div>
      <p className="text-sm text-ink-500">Chat exactly like a customer would, and see how the AI responds — including the tools it uses.</p>

      {/* History sidebar */}
      {showHistory && aiTurns.length > 0 && (
        <div className="card p-3 max-h-64 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-sm">Recent AI Replies ({aiTurns.length})</span>
            <button onClick={() => setShowHistory(false)} className="text-xs text-ink-500 hover:underline">Close</button>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {aiTurns.slice(-10).reverse().map((t, i) => (
              <div key={i} className="p-2 bg-ink-50 rounded text-xs border border-ink-100">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium opacity-60">AI Assistant</span>
                  <span className="text-[10px] text-ink-300">{new Date(t.at).toLocaleTimeString()}</span>
                </div>
                <div className="truncate text-ink-600 mb-1" dir="auto">{t.text.slice(0, 120)}</div>
                {t.tools && t.tools.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {t.tools.map((tool, idx) => (
                      <button key={idx} onClick={() => copyToClipboard(tool, "Tool")} className="px-1.5 py-0.5 text-[10px] bg-brand-50 text-brand-700 rounded hover:bg-brand-100 transition" title="Copy tool name">
                        {tool}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card flex min-h-[420px] flex-col">
        <div ref={scrollRef} className="chat-scroll max-h-[480px] flex-1 space-y-2 overflow-y-auto p-4">
          {turns.length === 0 && (
            <div className="space-y-4 p-4 text-center">
              <Empty
                title="Start a conversation"
                hint="Type as a customer would. Try a full order, a price question, or an escalation."
                icon={<svg className="w-10 h-10 mx-auto text-ink-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>}
                actionHref="#"
                actionLabel=""
              />
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} dir="auto" className="btn-ghost text-xs" onClick={() => send(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className={`flex ${t.from === "me" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${t.from === "me" ? "bg-ink-900 text-white" : "border border-brand-100 bg-brand-50/50"}`}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[11px] font-medium opacity-60">{t.from === "me" ? "Customer (you)" : "AI Assistant"}</span>
                  <span className="text-[10px] opacity-40">{new Date(t.at).toLocaleTimeString()}</span>
                </div>
                {t.image && (
                  <div className="mb-1 relative">
                    <img src={t.image} alt="Product photo sent with this reply" className="max-h-48 rounded-md border border-ink-100 object-cover cursor-zoom-in" loading="lazy" onClick={() => openImage(t.image!)} />
                    <div className="absolute top-1 right-1 flex gap-1">
                      <button onClick={() => copyToClipboard(t.image!, "Image URL")} className="p-1 bg-white/90 rounded hover:bg-white" title="Copy image URL">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                      </button>
                      <a href={t.image} target="_blank" rel="noopener noreferrer" className="p-1 bg-white/90 rounded hover:bg-white" title="Open in new tab">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                      </a>
                    </div>
                  </div>
                )}
                <div dir="auto" className="whitespace-pre-line">{t.text}</div>
                {t.tools && t.tools.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {t.tools.map((tool, idx) => (
                      <button key={idx} onClick={() => copyToClipboard(tool, "Tool")} className="px-2 py-0.5 text-[10px] bg-brand-50 text-brand-700 rounded hover:bg-brand-100 transition font-mono" title="Copy tool name">
                        {tool}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && <div className="text-sm text-ink-300 flex items-center gap-2" role="status">
            <svg className="animate-spin w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
            Assistant is checking inventory…
          </div>}
        </div>
        <div className="flex gap-2 border-t border-ink-100 p-3">
          <input
            className="input"
            dir="auto"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
            placeholder="Type as a customer… / اكتب كأنك عميل…"
            aria-label="Test message"
            disabled={busy}
          />
          <button className="btn-primary" onClick={() => send()} disabled={busy || !input.trim()}>
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </div>

      {/* Image preview modal */}
      {imagePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setImagePreview(null)} role="dialog" aria-modal="true" aria-label="Image preview">
          <div className="relative max-w-4xl max-h-[90vh]">
            <img src={imagePreview} alt="Product photo" className="max-w-full max-h-[80vh] object-contain" />
            <button onClick={() => setImagePreview(null)} className="absolute top-4 right-4 p-2 bg-white/90 rounded-full hover:bg-white" aria-label="Close">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
