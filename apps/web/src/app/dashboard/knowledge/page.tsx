"use client";
import { useState, type FormEvent } from "react";
import { useApi, Loading, Err, Empty } from "@/components/ui";

export default function Knowledge() {
  const { data, loading, error } = useApi<{ documents: Array<{ id: string; title: string; type: string; status: string; version: number; chunkCount: number; error?: string | null; updatedAt: string }> }>("/api/knowledge");
  const [form, setForm] = useState({ title: "", type: "FAQ", content: "" });
  const [msg, setMsg] = useState("");

  async function add(e: FormEvent) {
    e.preventDefault();
    setMsg("");
    const r = await fetch("/api/knowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const j = await r.json();
    if (!j.ok) setMsg(j?.error?.message ?? JSON.stringify(j?.error?.details ?? "Failed"));
    else window.location.reload();
  }

  async function remove(id: string) {
    if (!confirm("Delete this document and its embeddings?")) return;
    await fetch(`/api/knowledge/${id}`, { method: "DELETE" });
    window.location.reload();
  }

  async function reindex(id: string, title: string) {
    const content = prompt(`New content for "${title}" (replaces all chunks, bumps version):`);
    if (!content || !content.trim()) return;
    const r = await fetch(`/api/knowledge/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
    const j = await r.json();
    if (!j.ok) alert(j?.error?.message ?? "Re-index failed");
    else window.location.reload();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold tracking-tight">Knowledge Base</h1>
      <p className="text-sm text-ink-500">Policies, FAQs and guides the AI uses to answer your customers. Prices and stock always come from your catalog.</p>
      <form onSubmit={add} className="card space-y-3 p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_160px]">
          <div><label className="label">Title</label><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></div>
          <div><label className="label">Type</label>
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option>FAQ</option><option>POLICY</option><option>GUIDE</option><option>PROMOTION</option><option>DESCRIPTION</option><option>TEXT</option>
            </select>
          </div>
        </div>
        <div><label className="label">Content</label><textarea className="input min-h-[120px]" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} required /></div>
        <button className="btn-primary">Add & index</button>
        {msg && <span className="text-sm text-red-700">{msg}</span>}
      </form>
      {loading && <Loading />}
      {error && <Err message={error} />}
      {data && data.documents.length === 0 && <Empty title="No documents yet" hint="Add your store policies, FAQs and product guides so the AI can answer accurately." />}
      {data && data.documents.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Document</th><th>Type</th><th>Status</th><th>Ver</th><th>Chunks</th><th>Updated</th><th></th></tr></thead>
            <tbody>
              {data.documents.map((d) => (
                <tr key={d.id}>
                  <td className="font-semibold">{d.title}{d.error && <div className="text-xs text-red-700">{d.error}</div>}</td>
                  <td>{d.type}</td>
                  <td>{d.status === "READY" ? <span className="badge-green">READY</span> : d.status === "FAILED" ? <span className="badge-red">FAILED</span> : <span className="badge-amber">{d.status}</span>}</td>
                  <td className="tabular-nums">v{d.version ?? 1}</td>
                  <td>{d.chunkCount}</td>
                  <td className="text-xs text-ink-500">{new Date(d.updatedAt).toLocaleString()}</td>
                  <td className="whitespace-nowrap">
                    <button className="me-2 text-xs text-brand-700 hover:underline" onClick={() => reindex(d.id, d.title)}>Edit & re-index</button>
                    <button className="text-xs text-red-700 hover:underline" onClick={() => remove(d.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
