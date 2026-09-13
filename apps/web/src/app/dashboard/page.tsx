"use client";
import Link from "next/link";
import { useApi, Stat, Loading, Err, Empty, StatusBadge, formatEGP, timeAgo } from "@/components/ui";

interface DayPoint { day: string; label: string; orders: number; revenue: number }

function OrdersChart({ days }: { days: DayPoint[] }) {
  const max = Math.max(1, ...days.map((d) => d.orders));
  const total = days.reduce((s, d) => s + d.orders, 0);
  if (total === 0) {
    return <p className="p-5 text-sm text-ink-300">No orders in the last 14 days — new orders will chart here automatically.</p>;
  }
  return (
    <div>
      <div className="flex h-36 items-end gap-1.5 px-5 pt-5" role="img" aria-label={`Orders per day, ${total} total in 14 days`}>
        {days.map((d) => (
          <div key={d.day} className="group relative flex h-full flex-1 items-end">
            <div
              className="w-full rounded-t bg-brand-600/80 transition-colors group-hover:bg-brand-600"
              style={{ height: `${Math.max(3, (d.orders / max) * 100)}%`, opacity: d.orders === 0 ? 0.15 : 1 }}
            >
              <title>{`${d.label}: ${d.orders} orders · ${formatEGP(d.revenue)}`}</title>
            </div>
            <div className="pointer-events-none absolute -top-1 left-1/2 hidden -translate-x-1/2 -translate-y-full whitespace-nowrap rounded bg-ink-900 px-2 py-1 text-[11px] text-white group-hover:block">
              {d.label}: {d.orders} orders
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 px-5 pb-4 pt-1">
        {days.map((d, i) => (
          <div key={d.day} className="flex-1 truncate text-center text-[10px] text-ink-300">
            {i % 2 === 0 ? d.label.split(" ")[0] : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Overview() {
  const { data, loading, error } = useApi<{
    todayOrders: number; pendingOrders: number; revenue: number; conversations: number;
    conversionRate: number; handoffs: number; failedRuns: number; lowStock: number;
    daily: DayPoint[];
    recentOrders: Array<{ id: string; number: number; status: string; total: number; createdAt: string; customerName?: string | null; customerPhone?: string | null }>;
  }>("/api/analytics/overview");

  if (loading) return <Loading />;
  if (error || !data) return <Err message={error || "Failed"} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">Overview</h1>
          <p className="text-sm text-ink-500">How your AI employee performed today.</p>
        </div>
        <Link className="btn-ghost text-xs" href="/dashboard/playground">Test AI →</Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Today's orders" value={data.todayOrders} href="/dashboard/orders" />
        <Stat label="Pending" value={data.pendingOrders} href="/dashboard/orders" sub="Needs your action" />
        <Stat label="Revenue" value={formatEGP(data.revenue)} sub="Non-cancelled" />
        <Stat label="Conversion" value={`${data.conversionRate}%`} sub="Chats → orders" />
        <Stat label="AI conversations" value={data.conversations} href="/dashboard/inbox" />
        <Stat label="Human handoffs" value={data.handoffs} href="/dashboard/inbox" sub={data.conversations ? `${Math.round((data.handoffs / data.conversations) * 100)}% of chats` : undefined} />
        <Stat label="AI failures" value={data.failedRuns} href={data.failedRuns > 0 ? "/dashboard/inbox" : undefined} sub={data.failedRuns > 0 ? "Review in inbox" : "All clear"} />
        <Stat label="Low stock" value={data.lowStock} href="/dashboard/inventory" sub="Variants ≤ threshold" />
      </div>
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">Orders · last 14 days</span>
          <Link className="text-xs text-brand-700 hover:underline" href="/dashboard/analytics">Full analytics →</Link>
        </div>
        <OrdersChart days={data.daily ?? []} />
      </div>
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">Recent orders</span>
          <Link className="text-xs text-brand-700 hover:underline" href="/dashboard/orders">View all →</Link>
        </div>
        {data.recentOrders.length === 0 ? (
          <Empty title="No orders yet" hint="Orders confirmed by the AI will land here in real time." actionHref="/dashboard/playground" actionLabel="Preview the AI" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Total</th><th>Placed</th><th></th></tr></thead>
              <tbody>
                {data.recentOrders.map((o) => (
                  <tr key={o.id}>
                    <td className="font-semibold">#{o.number}</td>
                    <td dir="auto">{o.customerName ?? o.customerPhone ?? "—"}</td>
                    <td><StatusBadge status={o.status} /></td>
                    <td className="tabular-nums">{formatEGP(o.total)}</td>
                    <td className="whitespace-nowrap text-xs text-ink-500">{timeAgo(o.createdAt)}</td>
                    <td><Link className="text-brand-700 hover:underline" href={`/dashboard/orders/${o.id}`}>Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
