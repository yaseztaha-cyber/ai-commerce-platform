"use client";
import { useState } from "react";
import Link from "next/link";
import { useApi, Loading, Err, StatusBadge, formatEGP } from "@/components/ui";

interface CustomerDetail {
  id: string; name?: string | null; phone: string; email?: string | null;
  notes?: string | null; tags: string[]; preferredLanguage?: string | null;
  marketingConsent: boolean; totalOrders: number; totalSpent: number;
  firstSeenAt: string; lastSeenAt: string;
  addresses: Array<{ id: string; label?: string | null; address: string; city?: string | null }>;
  orders: Array<{ id: string; number: number; status: string; total: number; createdAt: string; items: Array<{ productName: string; variantLabel: string; quantity: number }> }>;
  conversations: Array<{ id: string; channel: string; status: string; orderState: string; lastMessageAt: string }>;
}

export default function CustomerPage({ params }: { params: { id: string } }) {
  const { data, loading, error } = useApi<{ customer: CustomerDetail }>(`/api/customers/${params.id}`);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", notes: "", tags: "", marketingConsent: false });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  function startEdit() {
    if (!data) return;
    const c = data.customer;
    setForm({
      name: c.name ?? "",
      email: c.email ?? "",
      notes: c.notes ?? "",
      tags: c.tags.join(", "),
      marketingConsent: c.marketingConsent,
    });
    setEditing(true);
  }

  async function save() {
    setBusy(true);
    setMsg("");
    const r = await fetch(`/api/customers/${params.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name || null,
        email: form.email || null,
        notes: form.notes || null,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        marketingConsent: form.marketingConsent,
      }),
    });
    const j = await r.json();
    setBusy(false);
    if (!j.ok) setMsg(j?.error?.message ?? "Failed");
    else window.location.reload();
  }

  async function erase() {
    if (!confirm("Erase this customer's personal data? Orders are kept (anonymized) for records.")) return;
    const r = await fetch(`/api/customers/${params.id}`, { method: "DELETE" });
    const j = await r.json();
    if (!j.ok) setMsg(j?.error?.message ?? "Failed");
    else window.location.href = "/dashboard/customers";
  }

  if (loading) return <Loading />;
  if (error || !data) return <Err message={error || "Failed"} />;
  const c = data.customer;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold tracking-tight">{c.name ?? c.phone}</h1>
        <div className="flex gap-2">
          <button className="btn-ghost text-xs" onClick={() => (editing ? setEditing(false) : startEdit())}>{editing ? "Cancel" : "Edit"}</button>
          <button className="btn-ghost text-xs text-red-700" onClick={erase}>Erase data</button>
        </div>
      </div>
      {msg && <div className="card border-red-200 bg-red-50 p-3 text-sm text-red-800">{msg}</div>}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card space-y-2 p-5 text-sm">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Profile</h2>
          {!editing ? (
            <>
              <div>Phone: <span className="font-mono text-xs">{c.phone}</span></div>
              <div>Email: {c.email ?? "—"}</div>
              <div>Language: {c.preferredLanguage ?? "—"}</div>
              <div>Tags: {c.tags.length ? c.tags.join(", ") : "—"}</div>
              <div>Marketing consent: {c.marketingConsent ? "yes" : "no"}</div>
              <div>Orders: {c.totalOrders} · Spent: <span className="tabular-nums">{formatEGP(c.totalSpent)}</span></div>
              <div className="text-xs text-ink-300">First seen {new Date(c.firstSeenAt).toLocaleString()} · Last seen {new Date(c.lastSeenAt).toLocaleString()}</div>
              {c.notes && <div className="rounded-md bg-ink-50 p-2 text-xs">Notes: {c.notes}</div>}
            </>
          ) : (
            <>
              <div><label className="label">Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div><label className="label">Tags (comma separated)</label><input className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></div>
              <div><label className="label">Notes</label><textarea className="input min-h-[80px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.marketingConsent} onChange={(e) => setForm({ ...form, marketingConsent: e.target.checked })} /> Marketing consent</label>
              <button disabled={busy} onClick={save} className="btn-primary text-xs">Save</button>
            </>
          )}
          {c.addresses.length > 0 && (
            <div className="pt-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-ink-500">Addresses</h3>
              <ul className="mt-1 space-y-1 text-xs">
                {c.addresses.map((a) => <li key={a.id}>{a.label ? `${a.label}: ` : ""}{a.address}{a.city ? `, ${a.city}` : ""}</li>)}
              </ul>
            </div>
          )}
        </div>
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Orders ({c.orders.length})</h2>
            {c.orders.length === 0 && <p className="mt-2 text-sm text-ink-300">No orders yet.</p>}
            <ul className="mt-2 space-y-2 text-sm">
              {c.orders.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 border-b border-ink-100 pb-1">
                  <span>#{o.number} <StatusBadge status={o.status} /> <span className="text-xs text-ink-500">{o.items.map((i) => `${i.productName} ×${i.quantity}`).join("; ")}</span></span>
                  <span className="flex items-center gap-2 tabular-nums">{o.total} <Link className="text-xs text-brand-700 hover:underline" href={`/dashboard/orders/${o.id}`}>Open</Link></span>
                </li>
              ))}
            </ul>
          </div>
          <div className="card p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Conversations ({c.conversations.length})</h2>
            {c.conversations.length === 0 && <p className="mt-2 text-sm text-ink-300">No conversations yet.</p>}
            <ul className="mt-2 space-y-2 text-sm">
              {c.conversations.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2 border-b border-ink-100 pb-1">
                  <span>{v.channel} · {v.orderState} <StatusBadge status={v.status} /></span>
                  <Link className="text-xs text-brand-700 hover:underline" href={`/dashboard/inbox`}>Inbox</Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
