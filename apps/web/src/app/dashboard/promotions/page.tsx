"use client";
import { useState, type FormEvent } from "react";
import { useApi, Loading, Err, Empty } from "@/components/ui";

interface Promo {
  id: string; name: string; kind: string; value: number;
  minSubtotal?: number | null; buyQty?: number | null; getQty?: number | null;
  startAt?: string | null; endAt?: string | null; active: boolean;
  usageLimit?: number | null; usedCount: number;
}

function describeKind(p: Promo): string {
  switch (p.kind) {
    case "PERCENT":
      return `${p.value}% off`;
    case "FIXED":
      return `${p.value} EGP off`;
    case "BXGY":
      return `Buy ${p.buyQty} get ${p.getQty}`;
    case "FREE_SHIPPING":
      return "Free shipping";
    default:
      return p.kind;
  }
}

export default function Promotions() {
  const { data, loading, error } = useApi<{ promotions: Promo[] }>("/api/promotions");
  const [form, setForm] = useState({ name: "", kind: "PERCENT", value: "10", minSubtotal: "", usageLimit: "" });
  const [msg, setMsg] = useState("");

  async function create(e: FormEvent) {
    e.preventDefault();
    setMsg("");
    const body: Record<string, unknown> = {
      name: form.name,
      kind: form.kind,
      value: Number(form.value) || 0,
      minSubtotal: form.minSubtotal === "" ? null : Number(form.minSubtotal),
      usageLimit: form.usageLimit === "" ? null : Number(form.usageLimit),
      active: true,
    };
    const r = await fetch("/api/promotions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) setMsg(j?.error?.message ?? "Failed");
    else window.location.reload();
  }

  async function remove(id: string) {
    if (!confirm("Delete this promotion? Past orders keep their snapshots.")) return;
    await fetch(`/api/promotions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    window.location.reload();
  }

  if (loading) return <Loading />;
  if (error || !data) return <Err message={error || "Failed"} />;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold tracking-tight">Promotions</h1>
      <p className="text-sm text-ink-500">
        Create discounts the AI can offer your customers. Only promotions listed here will ever be applied.
      </p>
      <form onSubmit={create} className="card flex flex-wrap items-end gap-3 p-4">
        <div><label className="label">Name</label><input className="input w-44" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Summer discount" /></div>
        <div><label className="label">Kind</label>
          <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            <option value="PERCENT">Percent %</option>
            <option value="FIXED">Fixed EGP</option>
            <option value="BXGY">Buy X get Y</option>
            <option value="FREE_SHIPPING">Free shipping</option>
          </select>
        </div>
        {form.kind !== "FREE_SHIPPING" && (
          <div><label className="label">{form.kind === "PERCENT" ? "Percent (1–90)" : "Amount (EGP)"}</label><input className="input w-28" type="number" min={0} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} required /></div>
        )}
        <div><label className="label">Min subtotal (optional)</label><input className="input w-28" type="number" min={0} value={form.minSubtotal} onChange={(e) => setForm({ ...form, minSubtotal: e.target.value })} /></div>
        <div><label className="label">Usage cap (optional)</label><input className="input w-28" type="number" min={1} value={form.usageLimit} onChange={(e) => setForm({ ...form, usageLimit: e.target.value })} /></div>
        <button className="btn-primary">Add promotion</button>
        {msg && <span className="text-sm text-red-700">{msg}</span>}
      </form>
      {data.promotions.length === 0 && <Empty title="No promotions yet" hint="Create one above and the AI will start offering it to customers." />}
      {data.promotions.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Name</th><th>Offer</th><th>Min</th><th>Used</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {data.promotions.map((p) => (
                <tr key={p.id}>
                  <td className="font-semibold">{p.name}</td>
                  <td>{describeKind(p)}</td>
                  <td className="tabular-nums">{p.minSubtotal ?? "—"}</td>
                  <td className="tabular-nums">{p.usedCount}{p.usageLimit != null ? ` / ${p.usageLimit}` : ""}</td>
                  <td>{p.active ? <span className="badge-green">Active</span> : <span className="badge-gray">Off</span>}</td>
                  <td><button className="text-xs text-red-700 hover:underline" onClick={() => remove(p.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
