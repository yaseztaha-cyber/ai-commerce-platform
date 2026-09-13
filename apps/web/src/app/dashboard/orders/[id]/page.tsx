"use client";
import { useState } from "react";
import { useApi, Loading, Err, StatusBadge, formatEGP } from "@/components/ui";

const NEXT: Record<string, string[]> = {
  DRAFT: ["PENDING_CONFIRMATION", "CANCELLED"],
  PENDING_CONFIRMATION: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["READY", "CANCELLED"],
  READY: ["OUT_FOR_DELIVERY", "CANCELLED"],
  OUT_FOR_DELIVERY: ["COMPLETED", "RETURNED"],
  COMPLETED: ["RETURNED", "REFUNDED"],
};

export default function OrderDetail({ params }: { params: { id: string } }) {
  const { data, loading, error } = useApi<{ order: { id: string; number: number; status: string; subtotal: number; deliveryFee: number; total: number; customerName?: string | null; customerPhone?: string | null; address?: string | null; notes?: string | null; paymentMethod: string; trackingNumber?: string | null; trackingUrl?: string | null; courier?: string | null; items: Array<{ variantId: string; productName: string; variantLabel: string; sku?: string | null; unitPrice: number; quantity: number; lineTotal: number }>; history: Array<{ oldStatus?: string | null; newStatus: string; actor: string; reason?: string | null; createdAt: string }> } }>(`/api/orders/${params.id}`);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function transition(to: string, restock = false) {
    setBusy(true);
    setMsg("");
    if (to === "REFUNDED" && !confirm("Mark this order as refunded? The money must be refunded through your payment account separately.")) {
      setBusy(false);
      return;
    }
    if ((to === "RETURNED" || to === "CANCELLED") && restock && !confirm(`Mark ${to} AND return reserved stock to inventory?`)) {
      setBusy(false);
      return;
    }
    const r = await fetch(`/api/orders/${params.id}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, restock }) });
    const j = await r.json();
    setBusy(false);
    if (!j.ok) setMsg(j?.error?.message ?? "Failed");
    else window.location.reload();
  }

  async function bookPickup() {
    setBusy(true);
    setMsg("");
    const r = await fetch(`/api/shipping/book-pickup?orderId=${params.id}`, { method: "POST" });
    const j = await r.json();
    setBusy(false);
    if (!j.ok) setMsg(j?.error?.message ?? "Failed to book pickup");
    else {
      setMsg(`Pickup booked! Tracking: ${j.trackingNumber}`);
      window.location.reload();
    }
  }

  const [editing, setEditing] = useState(false);
  const [eform, setEform] = useState<{ address: string; qtys: Record<string, number> } | null>(null);

  function startEdit() {
    setEform({
      address: o.address ?? "",
      qtys: Object.fromEntries(o.items.map((i) => [i.variantId, i.quantity])),
    });
    setEditing(true);
  }

  async function saveEdit() {
    if (!eform) return;
    setBusy(true);
    setMsg("");
    const body: Record<string, unknown> = { address: eform.address };
    if (o.status === "CONFIRMED") {
      body.items = o.items.map((i) => ({ variantId: i.variantId, quantity: Math.max(1, Math.min(99, eform.qtys[i.variantId] ?? i.quantity)) }));
    }
    const r = await fetch(`/api/orders/${params.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    setBusy(false);
    if (!j.ok) setMsg(j?.error?.message ?? "Failed");
    else window.location.reload();
  }

  if (loading) return <Loading />;
  if (error || !data) return <Err message={error || "Failed"} />;
  const o = data.order;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold">Order #{o.number} <StatusBadge status={o.status} /></h1>
        <div className="flex flex-wrap gap-2">
          {(NEXT[o.status] ?? []).map((s) => (
            (s === "RETURNED" || s === "CANCELLED")
              ? <span key={s} className="flex gap-1">
                  <button disabled={busy} onClick={() => transition(s)} className="btn-ghost text-xs" title="Keep stock reserved">→ {s}</button>
                  <button disabled={busy} onClick={() => transition(s, true)} className="btn-ghost text-xs" title="Return reserved items to stock">→ {s} + restock</button>
                </span>
              : <button key={s} disabled={busy} onClick={() => transition(s)} className="btn-ghost text-xs">→ {s}</button>
          ))}
          {["CONFIRMED", "PROCESSING", "READY"].includes(o.status) && (
            <button disabled={busy} onClick={() => (editing ? setEditing(false) : startEdit())} className="btn-ghost text-xs">
              {editing ? "Close editor" : "Edit order"}
            </button>
          )}
          {["CONFIRMED", "PROCESSING", "READY"].includes(o.status) && !o.trackingNumber && (
            <button disabled={busy} onClick={bookPickup} className="btn-primary text-xs">
              {busy ? "Booking..." : "Book pickup"}
            </button>
          )}
          {o.trackingNumber && o.trackingUrl && (
            <a href={o.trackingUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost text-xs">
              View label
            </a>
          )}
        </div>
      </div>
      {msg && <div className="card border-red-200 bg-red-50 p-3 text-sm text-red-800">{msg}</div>}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Items (price snapshots)</h2>
          <table className="table mt-2">
            <thead><tr><th>Item</th><th>Unit</th><th>Qty</th><th>Total</th></tr></thead>
            <tbody>
              {o.items.map((i, idx) => (
                <tr key={idx}><td>{i.productName} — {i.variantLabel}<div className="text-xs text-ink-300">{i.sku}</div></td><td>{i.unitPrice}</td><td>{i.quantity}</td><td>{i.lineTotal}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 space-y-1 text-sm tabular-nums">
            <div className="flex justify-between"><span>Subtotal</span><span>{formatEGP(o.subtotal)}</span></div>
            <div className="flex justify-between"><span>Delivery</span><span>{formatEGP(o.deliveryFee)}</span></div>
            <div className="flex justify-between font-bold"><span>Total</span><span>{formatEGP(o.total)}</span></div>
          </div>
        </div>
        <div className="space-y-4">
          <div className="card p-5 text-sm">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Customer</h2>
            <div className="mt-2">{o.customerName ?? "—"} · {o.customerPhone ?? "—"}</div>
            <div className="text-ink-500">{o.address ?? "No address"}</div>
            <div className="mt-1">Payment: {o.paymentMethod}</div>
            {o.trackingNumber && (
              <div className="mt-2 text-sm">
                <span className="font-medium">Tracking: </span>
                {o.trackingUrl
                  ? <a href={o.trackingUrl} target="_blank" rel="noopener noreferrer" className="underline text-brand-600">{o.trackingNumber}</a>
                  : <span>{o.trackingNumber}</span>}
                {o.courier && <span className="text-ink-500 ml-2">({o.courier})</span>}
              </div>
            )}
            {o.notes && <div className="mt-1 text-ink-500">Notes: {o.notes}</div>}
          </div>
          {editing && eform && (
            <div className="card border-brand-100 bg-brand-50/50 p-5 text-sm">
              <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Edit order</h2>
              <label className="label mt-3">Delivery address</label>
              <textarea className="input min-h-[60px]" value={eform.address} onChange={(e) => setEform({ ...eform, address: e.target.value })} />
              {o.status === "CONFIRMED" ? (
                <>
                  <label className="label mt-3">Quantities</label>
                  {o.items.map((i) => (
                    <div key={i.variantId} className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-xs">{i.productName} — {i.variantLabel}</span>
                      <input className="input w-20" type="number" min={1} max={99} value={eform.qtys[i.variantId] ?? i.quantity} onChange={(e) => setEform({ ...eform, qtys: { ...eform.qtys, [i.variantId]: Number(e.target.value) } })} />
                    </div>
                  ))}
                </>
              ) : (
                <p className="mt-2 text-xs text-ink-500">Only the delivery address can be changed at this stage.</p>
              )}
              <button disabled={busy} onClick={saveEdit} className="btn-primary mt-3 text-xs">Save changes</button>
            </div>
          )}
          <div className="card p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Timeline</h2>
            <ol className="mt-2 space-y-2 text-sm">
              {o.history.map((h, i) => (
                <li key={i} className="flex justify-between gap-2 border-b border-ink-100 pb-1">
                  <span>{h.oldStatus ?? "—"} → <b>{h.newStatus}</b> <span className="text-ink-300">by {h.actor}</span></span>
                  <span className="text-xs text-ink-300">{new Date(h.createdAt).toLocaleString()}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
