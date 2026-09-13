"use client";
import { useEffect, useState } from "react";
import { useApi, Loading, Err } from "@/components/ui";

type PlanCaps = {
  slug: string;
  name: string;
  priceEgp: number;
  maxAiMessages: number | null;
  maxProducts: number | null;
  maxSeats: number | null;
  maxDocuments: number | null;
};

type BillingData = {
  subscription: { status: string; plan: PlanCaps };
  usage: { period: string; messages: number; aiRuns: number; documents: number; products: number; seats: number };
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  providerStatus: { synced: boolean; paid?: boolean };
  plans: PlanCaps[];
};

function overages(usage: BillingData["usage"], caps: PlanCaps): string[] {
  const out: string[] = [];
  if (caps.maxAiMessages != null && usage.aiRuns > caps.maxAiMessages) out.push(`AI messages ${usage.aiRuns}/${caps.maxAiMessages}`);
  if (caps.maxProducts != null && usage.products > caps.maxProducts) out.push(`products ${usage.products}/${caps.maxProducts}`);
  if (caps.maxSeats != null && usage.seats > caps.maxSeats) out.push(`seats ${usage.seats}/${caps.maxSeats}`);
  if (caps.maxDocuments != null && usage.documents > caps.maxDocuments) out.push(`documents ${usage.documents}/${caps.maxDocuments}`);
  return out;
}

export default function BillingPage() {
  const { data, loading, error } = useApi<BillingData>("/api/billing/status");
  const [checkoutBusy, setCheckoutBusy] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState("");
  const [renewBusy, setRenewBusy] = useState(false);
  const [downgradeAsk, setDowngradeAsk] = useState<string | null>(null);
  const [downgradeBusy, setDowngradeBusy] = useState(false);
  const [downgradeMsg, setDowngradeMsg] = useState("");

  useEffect(() => {
    if (checkoutBusy) {
      fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planSlug: checkoutBusy }),
      })
        .then(async (r) => {
          const j = await r.json();
          if (!r.ok || !j.ok) throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
          return j.data as { url?: string };
        })
        .then((j: { url?: string }) => {
          if (j.url) window.location.href = j.url;
        })
        .catch((err: Error) => {
          setCheckoutError(err.message);
          setCheckoutBusy(null);
        });
    }
  }, [checkoutBusy]);

  useEffect(() => {
    if (!renewBusy) return;
    fetch("/api/billing/portal", { method: "POST" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
        return j.data as { url?: string };
      })
      .then((j: { url?: string }) => {
        if (j.url) window.location.href = j.url;
      })
      .catch((err: Error) => {
        setCheckoutError(err.message);
        setRenewBusy(false);
      });
  }, [renewBusy]);

  async function doDowngrade(slug: string) {
    setDowngradeBusy(true);
    setDowngradeMsg("");
    try {
      const r = await fetch("/api/billing/downgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planSlug: slug }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
      window.location.reload();
    } catch (err) {
      setDowngradeMsg(err instanceof Error ? err.message : "Downgrade failed");
      setDowngradeBusy(false);
    }
  }

  if (loading) return <Loading />;
  if (error || !data) return <Err message={error || "Failed to load billing info"} />;

  const { subscription, usage, trialEndsAt, currentPeriodEnd, providerStatus, plans } = data;
  const plan = subscription.plan;
  const isSuspended = subscription.status !== "ACTIVE";
  const trialEnd = trialEndsAt ? new Date(trialEndsAt) : null;
  const trialDaysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / 86400_000)) : null;
  const periodEnd = currentPeriodEnd ? new Date(currentPeriodEnd) : null;
  const busy = checkoutBusy !== null || renewBusy || downgradeBusy;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Billing</h1>

      {isSuspended && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-amber-800 text-sm">
          Your subscription is <strong>{subscription.status}</strong>. Please update your payment method to continue using all features.
          <button onClick={() => { setRenewBusy(true); setCheckoutError(""); }} disabled={renewBusy} className="ml-3 underline font-medium hover:text-amber-900 disabled:no-underline">
            {renewBusy ? "Redirecting…" : "Renew now"}
          </button>
        </div>
      )}

      {providerStatus.synced && providerStatus.paid === false && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-800 text-sm">
          Fawry reports this payment was not completed. You may need to retry checkout.
        </div>
      )}

      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-4">Current Plan</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-ink-500">Plan</p>
            <p className="font-medium">{plan.name}</p>
          </div>
          <div>
            <p className="text-ink-500">Status</p>
            <p className={`font-medium ${isSuspended ? "text-amber-600" : "text-emerald-600"}`}>{subscription.status}</p>
          </div>
          <div>
            <p className="text-ink-500">Price</p>
            <p className="font-medium">{plan.priceEgp > 0 ? `${plan.priceEgp} EGP/mo` : "Free"}</p>
          </div>
          <div>
            <p className="text-ink-500">Next billing</p>
            <p className="font-medium">{periodEnd ? periodEnd.toLocaleDateString("en-EG") : "—"}</p>
          </div>
          {trialDaysLeft !== null && trialDaysLeft > 0 && (
            <div>
              <p className="text-ink-500">Trial ends in</p>
              <p className="font-medium">{trialDaysLeft} days</p>
            </div>
          )}
        </div>
      </div>

      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-4">Usage — {usage.period}</h2>
        <div className="space-y-4">
          <UsageBar label="AI messages" used={usage.aiRuns} max={plan.maxAiMessages} />
          <UsageBar label="Products" used={usage.products} max={plan.maxProducts} />
          <UsageBar label="Seats" used={usage.seats} max={plan.maxSeats} />
          <UsageBar label="Documents" used={usage.documents} max={plan.maxDocuments} />
        </div>
      </div>

      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-4">Change Plan</h2>
        {checkoutError && <p className="text-red-600 text-sm mb-3">{checkoutError}</p>}
        {downgradeMsg && <p className="text-red-600 text-sm mb-3">{downgradeMsg}</p>}
        <div className="grid grid-cols-3 gap-4">
          {plans.map((p) => {
            const isCurrent = p.slug === plan.slug;
            const isFree = p.priceEgp <= 0;
            if (isCurrent) {
              return (
                <div key={p.slug} className="rounded-lg border p-4 text-left text-sm border-brand-200 bg-brand-50 text-brand-700">
                  <p className="font-semibold">{p.name}</p>
                  <p className="mt-1">{p.priceEgp > 0 ? `${p.priceEgp} EGP/mo` : "Free"}</p>
                  <p className="mt-2 text-xs font-medium">Current plan</p>
                </div>
              );
            }
            if (isFree && downgradeAsk === p.slug) {
              const over = overages(usage, p);
              return (
                <div key={p.slug} className="rounded-lg border p-4 text-left text-sm border-amber-300 bg-amber-50/50">
                  <p className="font-semibold">Downgrade to {p.name}?</p>
                  {over.length > 0 ? (
                    <p className="mt-1 text-xs text-amber-700">Over limits: {over.join(", ")}. Existing items keep working; new usage is gated.</p>
                  ) : (
                    <p className="mt-1 text-xs text-ink-500">Takes effect immediately.</p>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => void doDowngrade(p.slug)} disabled={downgradeBusy} className="btn-danger px-3 py-1 text-xs disabled:opacity-50">
                      {downgradeBusy ? "Working…" : "Confirm"}
                    </button>
                    <button onClick={() => setDowngradeAsk(null)} disabled={downgradeBusy} className="btn-ghost px-3 py-1 text-xs disabled:opacity-50">
                      Cancel
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <button
                key={p.slug}
                onClick={() => {
                  if (isFree) {
                    setDowngradeAsk(p.slug);
                    setDowngradeMsg("");
                  } else {
                    setCheckoutBusy(p.slug);
                    setCheckoutError("");
                  }
                }}
                disabled={busy}
                className="rounded-lg border p-4 text-left text-sm transition-colors border-ink-200 hover:border-brand-300 hover:bg-brand-50/50 disabled:opacity-50"
              >
                <p className="font-semibold">{p.name}</p>
                <p className="mt-1 text-ink-500">{p.priceEgp > 0 ? `${p.priceEgp} EGP/mo` : "Free"}</p>
                {checkoutBusy === p.slug && <p className="mt-2 text-xs text-ink-400">Redirecting…</p>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function UsageBar({ label, used, max }: { label: string; used: number; max: number | null }) {
  if (max === null) {
    return (
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span>{label}</span>
          <span className="text-ink-500">{used} / unlimited</span>
        </div>
      </div>
    );
  }
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const over = used > max;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span>{label}</span>
        <span className={over ? "text-red-600 font-medium" : "text-ink-500"}>
          {used} / {max}
        </span>
      </div>
      <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${over ? "bg-red-500" : "bg-brand-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
