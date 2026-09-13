"use client";
import Link from "next/link";
import { useApi, Loading, Err, Empty, formatEGP, timeAgo } from "@/components/ui";

export default function Customers() {
  const { data, loading, error } = useApi<{ customers: Array<{ id: string; name?: string | null; phone: string; totalOrders: number; totalSpent: number; lastSeenAt: string }> }>("/api/customers");
  if (loading) return <Loading />;
  if (error || !data) return <Err message={error || "Failed"} />;
  if (data.customers.length === 0) return <Empty title="No customers yet" hint="Customers automatically appear here once they message your store." />;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold tracking-tight">Customers</h1>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Name</th><th>Phone</th><th>Orders</th><th>Spent</th><th>Last seen</th><th></th></tr></thead>
          <tbody>
            {data.customers.map((c) => (
              <tr key={c.id}>
                <td className="font-semibold">{c.name ?? "—"}</td>
                <td className="font-mono text-xs">{c.phone}</td>
                <td>{c.totalOrders}</td>
                <td className="tabular-nums">{formatEGP(c.totalSpent)}</td>
                <td className="whitespace-nowrap text-xs text-ink-500">{timeAgo(c.lastSeenAt)}</td>
                <td><Link className="text-xs text-brand-700 hover:underline" href={`/dashboard/customers/${c.id}`}>Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
