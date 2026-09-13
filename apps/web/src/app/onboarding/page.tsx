"use client";
import Link from "next/link";
import { useApi, Loading, Err } from "@/components/ui";

interface Step { key: string; label: string; done: boolean; href: string }

const DESCRIPTIONS: Record<string, string> = {
  products: "Create products, variants, prices and stock.",
  variants: "Sizes, colors and SKUs per product.",
  inventory: "Real quantities — the AI never invents stock.",
  delivery: "Zones and fees; the AI never invents them.",
  payment: "Cash on delivery, transfer, links or manual.",
  knowledge: "FAQs and policies for the AI.",
  voice: "Tone, greeting, brand voice.",
  channel: "Paste the webhook URL into Meta.",
  test: "Try a full order in the playground.",
};

const QUICK_TOOLS = [
  { key: "wizard", label: "Quick-Add Wizard", href: "/onboarding/wizard", desc: "3-step guided product creation (basics → variants → photos)" },
  { key: "bulk", label: "Bulk Variant Generator", href: "/onboarding/bulk", desc: "Color × size matrix with auto-SKUs in one click" },
  { key: "csv", label: "CSV v2 Import", href: "/onboarding/csv-v2", desc: "Column mapping preview, per-row errors, photo URLs" },
];

export default function Onboarding() {
  const { data, loading, error } = useApi<{ steps: Step[]; done: number; total: number; complete: boolean }>("/api/onboarding/status");
  if (loading) return <main className="mx-auto max-w-3xl px-6 py-12"><Loading /></main>;
  if (error || !data) return <main className="mx-auto max-w-3xl px-6 py-12"><Err message={error || "Sign in to see your setup checklist."} /></main>;
  const pct = Math.round((data.done / Math.max(1, data.total)) * 100);
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-extrabold tracking-tight">Get your store live</h1>
      <p className="mt-1 text-sm text-ink-500">{data.done} of {data.total} steps complete — about 15 minutes.</p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-100">
        <div className="h-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
      </div>
      {data.complete && <p className="card mt-4 border-brand-100 bg-brand-50 p-4 text-sm font-semibold text-brand-700">Setup complete — your AI employee is ready for customers.</p>}

      <h2 className="mt-8 font-bold">Power tools for catalog</h2>
      <p className="mt-1 text-sm text-ink-500">Speed up onboarding for large catalogs.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {QUICK_TOOLS.map((t) => (
          <Link key={t.key} href={t.href} className="card p-4 hover:border-brand-200 transition">
            <div className="font-semibold">{t.label}</div>
            <div className="mt-1 text-sm text-ink-500">{t.desc}</div>
          </Link>
        ))}
      </div>

      <h2 className="mt-8 font-bold">Checklist</h2>
      <ol className="mt-6 space-y-3">
        {data.steps.map((s, i) => (
          <li key={s.key} className="card flex items-center justify-between gap-4 p-4">
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${s.done ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-500"}`}>
                {s.done ? "✓" : i + 1}
              </span>
              <div><div className="font-semibold">{s.label}</div><div className="text-sm text-ink-500">{DESCRIPTIONS[s.key] ?? ""}</div></div>
            </div>
            <Link className="btn-ghost text-xs" href={s.href}>Open</Link>
          </li>
        ))}
      </ol>
    </main>
  );
}
