"use client";
import { useApi, Loading, Err } from "@/components/ui";

export default function Admin() {
  const { data, loading, error } = useApi<{ tenants: Array<{ id: string; slug: string; name: string; _count: { orders: number; products: number; customers: number } }> }>("/api/admin/tenants");
  if (loading) return <main className="mx-auto max-w-5xl p-6"><Loading /></main>;
  if (error || !data) return <main className="mx-auto max-w-5xl p-6"><Err message={error || "Forbidden — platform admins only."} /></main>;
  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <h1 className="text-xl font-extrabold">Platform admin</h1>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Tenant</th><th>Slug</th><th>Orders</th><th>Products</th><th>Customers</th></tr></thead>
          <tbody>
            {data.tenants.map((t) => (
              <tr key={t.id}><td className="font-semibold">{t.name}</td><td className="font-mono text-xs">{t.slug}</td><td>{t._count.orders}</td><td>{t._count.products}</td><td>{t._count.customers}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
