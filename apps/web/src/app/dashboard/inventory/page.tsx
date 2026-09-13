"use client";
import { useState } from "react";
import { useApi, Loading, Err, Empty } from "@/components/ui";

export default function Inventory() {
  const { data, loading, error } = useApi<{ inventory: Array<{ variantId: string; sku: string; product: string; attributes: Record<string, string>; quantity: number; lowThreshold: number }> }>("/api/inventory");
  const [delta, setDelta] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");

  async function adjust(variantId: string) {
    const d = Number(delta[variantId]);
    if (!d) return;
    setMsg("");
    const r = await fetch("/api/inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ variantId, delta: d, type: d > 0 ? "RESTOCK" : "ADJUSTMENT", reason: "dashboard adjustment" }) });
    const j = await r.json();
    if (!j.ok) setMsg(j?.error?.message ?? "Failed");
    else window.location.reload();
  }

  if (loading) return <Loading />;
  if (error || !data) return <Err message={error || "Failed"} />;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold tracking-tight">Inventory</h1>
      {msg && <div className="card border-red-200 bg-red-50 p-3 text-sm text-red-800">{msg}</div>}
      {data.inventory.length === 0 && <Empty title="No variants yet" hint="Add products with variants and they will appear here." />}
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>SKU</th><th>Product</th><th>Variant</th><th>Stock</th><th>Adjust</th></tr></thead>
          <tbody>
            {data.inventory.map((r) => (
              <tr key={r.variantId}>
                <td className="font-mono text-xs">{r.sku}</td>
                <td>{r.product}</td>
                <td className="text-xs">{Object.values(r.attributes).join(" / ")}</td>
                <td>
                  <span className={r.quantity === 0 ? "badge-red" : r.quantity <= r.lowThreshold ? "badge-amber" : "badge-green"}>
                    {r.quantity}
                  </span>
                </td>
                <td>
                  <div className="flex gap-1">
                    <input className="input w-20" type="number" placeholder="+/-" value={delta[r.variantId] ?? ""} onChange={(e) => setDelta({ ...delta, [r.variantId]: e.target.value })} />
                    <button className="btn-ghost text-xs" onClick={() => adjust(r.variantId)}>Apply</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-300">All stock changes are logged in the movement history below.</p>
      <Movements />
    </div>
  );
}

function Movements() {
  const { data } = useApi<{ movements: Array<{ id: string; variantLabel: string; type: string; delta: number; before: number; after: number; reason?: string | null; actor?: string | null; createdAt: string }> }>("/api/inventory/movements?take=20");
  if (!data || data.movements.length === 0) return null;
  return (
    <div className="card overflow-x-auto">
      <div className="border-b border-ink-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Recent movements (actor · before → after · reason)</div>
      <table className="table">
        <thead><tr><th>Variant</th><th>Type</th><th>Change</th><th>Actor</th><th>Reason</th><th>When</th></tr></thead>
        <tbody>
          {data.movements.map((m) => (
            <tr key={m.id}>
              <td className="text-xs">{m.variantLabel}</td>
              <td><span className="badge-gray">{m.type}</span></td>
              <td className="tabular-nums">{m.before} → {m.after} ({m.delta > 0 ? "+" : ""}{m.delta})</td>
              <td className="text-xs text-ink-500">{m.actor ?? "—"}</td>
              <td className="text-xs text-ink-500">{m.reason ?? "—"}</td>
              <td className="text-xs text-ink-500">{new Date(m.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
