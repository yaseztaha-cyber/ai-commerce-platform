"use client";
import { useState, type FormEvent } from "react";
import { useApi, Loading, Err } from "@/components/ui";

export default function AiSettings() {
  const { data, loading, error } = useApi<{ tenant: Record<string, unknown> }>("/api/settings");
  const [form, setForm] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");

  if (loading) return <Loading />;
  if (error || !data) return <Err message={error || "Failed"} />;
  const t = data.tenant as Record<string, string | null>;
  const val = (k: string) => form[k] ?? (t[k] ?? "");

  async function save(e: FormEvent) {
    e.preventDefault();
    setMsg("");
    const r = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const j = await r.json();
    setMsg(j.ok ? "Saved." : (j?.error?.message ?? "Failed"));
  }

  const fields: Array<[string, string, boolean, string?]> = [
    ["aiPersonality", "Personality", false, "e.g. friendly, formal, casual"],
    ["aiTone", "Tone", false, "e.g. enthusiastic, calm, professional"],
    ["aiGreeting", "Greeting", true, "What the AI says first when a customer messages you"],
    ["aiInstructions", "Brand voice & instructions", true, "How the AI should handle questions about your products, policies and style"],
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold tracking-tight">AI Settings</h1>
      <p className="text-sm text-ink-500">How the AI talks to your customers. Stock, prices and orders always come from your live catalog.</p>
      <form onSubmit={save} className="card max-w-2xl space-y-4 p-6">
        {fields.map(([k, label, area, hint]) => (
          <div key={k}>
            <label className="label">{label}</label>
            {hint && <span className="text-xs text-ink-400">{hint}</span>}
            {area
              ? <textarea className="input min-h-[90px]" value={val(k)} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              : <input className="input" value={val(k)} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />}
          </div>
        ))}
        <button className="btn-primary">Save</button>
        {msg && <span className="text-sm text-ink-700">{msg}</span>}
      </form>
    </div>
  );
}
