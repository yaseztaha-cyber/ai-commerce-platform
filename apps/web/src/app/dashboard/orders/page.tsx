"use client";
import { useState } from "react";
import Link from "next/link";
import { useApi, Loading, Err, Empty, StatusBadge, formatEGP, timeAgo, humanizeStatus } from "@/components/ui";

const FILTERS = ["", "PENDING_CONFIRMATION", "CONFIRMED", "PROCESSING", "READY", "OUT_FOR_DELIVERY", "COMPLETED", "CANCELLED", "RETURNED", "REFUNDED"];

export default function Orders() {
  const [filter, setFilter] = useState("");
  const { data, loading, error } = useApi<{ orders: Array<{ id: string; number: number; status: string; total: number; customerPhone?: string | null; customerName?: string | null; createdAt: string; items: Array<{ productName: string; variantLabel: string; quantity: number }> }> }>(`/api/orders${filter ? `?status=${filter}` : ""}`);
  if (loading) return <Loading />;
  if (error || !data) return <Err message={error || "Failed"} />;
  if (data.orders.length === 0 && !filter) return <Empty title="No orders yet" hint="Orders confirmed by the AI will appear here." actionHref="/dashboard/playground" actionLabel="Preview the AI" />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold tracking-tight">Orders</h1>
        <select className="input w-48" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {FILTERS.filter(Boolean).map((s) => (
            <option key={s} value={s}>{humanizeStatus(s)}</option>
          ))}
        </select>
      </div>
      {data.orders.length === 0 && <Empty title={`No ${humanizeStatus(filter).toLowerCase()} orders`} />}
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {data.orders.map((o) => (
              <tr key={o.id}>
                <td className="font-semibold">#{o.number}</td>
                <td>{o.customerName ?? o.customerPhone ?? "—"}</td>
                <td className="max-w-[280px]">{o.items.map((i) => `${i.productName} ${i.variantLabel} ×${i.quantity}`).join("; ")}</td>
                <td className="tabular-nums">{formatEGP(o.total)}</td>
                <td><StatusBadge status={o.status} /></td>
                <td className="whitespace-nowrap text-xs text-ink-500">{timeAgo(o.createdAt)}</td>
                <td><Link className="text-brand-700 hover:underline" href={`/dashboard/orders/${o.id}`}>Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
