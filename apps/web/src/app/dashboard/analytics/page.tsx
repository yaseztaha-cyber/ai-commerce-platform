"use client";
import { useApi, Loading, Err, Stat, formatEGP } from "@/components/ui";

export default function Analytics() {
  const { data, loading, error } = useApi<{
    todayOrders: number; pendingOrders: number; revenue: number; conversations: number; conversionRate: number; handoffs: number; failedRuns: number; lowStock: number;
    usage?: { period: string; plan: string; aiRuns: { used: number; limit: number | null }; documents: { used: number; limit: number | null }; messages: { used: number; limit: number | null }; transcriptions: { used: number; limit: number | null }; visions: { used: number; limit: number | null } };
  }>("/api/analytics/overview");
  if (loading) return <Loading />;
  if (error || !data) return <Err message={error || "Failed"} />;
  const fmt = (u?: { used: number; limit: number | null }) => (u ? (u.limit == null ? `${u.used} / ∞` : `${u.used} / ${u.limit}`) : "—");
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold tracking-tight">Analytics</h1>
      <p className="text-sm text-ink-500">Your store&apos;s sales and AI performance, updated in real time.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Orders today" value={data.todayOrders} />
        <Stat label="Revenue (non-cancelled)" value={formatEGP(data.revenue)} />
        <Stat label="Conversations" value={data.conversations} />
        <Stat label="Conversion" value={`${data.conversionRate}%`} />
        <Stat label="Human handoff rate" value={data.conversations ? `${Math.round((data.handoffs / data.conversations) * 100)}%` : "0%"} />
        <Stat label="AI failures" value={data.failedRuns} />
      </div>
      {data.usage && (
        <div className="card p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Plan usage — {data.usage.plan} ({data.usage.period})</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="AI replies" value={fmt(data.usage.aiRuns)} />
            <Stat label="Knowledge docs" value={fmt(data.usage.documents)} />
            <Stat label="Messages" value={fmt(data.usage.messages)} />
            <Stat label="Voice transcriptions" value={fmt(data.usage.transcriptions)} />
            <Stat label="Photo sightings" value={fmt(data.usage.visions)} />
          </div>
          <p className="mt-2 text-xs text-ink-300">Usage for the current billing period.</p>
        </div>
      )}
    </div>
  );
}
