"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useApi, Loading, Err } from "@/components/ui";

export default function Settings() {
  const { data, loading, error } = useApi<{ tenant: Record<string, string | number | boolean | null> & { notificationConfig?: { ownerPhone?: string; channel?: string; webhookUrl?: string } | null } }>("/api/settings");
  const [form, setForm] = useState<Record<string, string>>({});
  const [verifyOn, setVerifyOn] = useState<boolean | null>(null);
  const [notify, setNotify] = useState({ ownerPhone: "", channel: "console", webhookUrl: "" });
  const [pw, setPw] = useState({ current: "", next: "", confirm: "", busy: false, msg: "" });
  const [msg, setMsg] = useState({ general: "", protection: "", notifications: "" });
  const NUMERIC_FIELDS = new Set(["minimumOrderAmount", "freeDeliveryThreshold", "cartNudgeHours"]);
  const t = data?.tenant;
  useEffect(() => {
    if (t?.notificationConfig) {
      setNotify({
        ownerPhone: t.notificationConfig.ownerPhone ?? "",
        channel: t.notificationConfig.channel ?? "console",
        webhookUrl: t.notificationConfig.webhookUrl ?? "",
      });
    }
  }, [t?.notificationConfig]);
  if (loading) return <Loading />;
  if (error || !data || !t) return <Err message={error || "Failed"} />;
  const val = (k: string) => form[k] ?? String(t[k] ?? "");
  const verifyChecked = verifyOn ?? Boolean(t.requirePhoneVerify);

  function sanitize(p: Record<string, unknown>): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
    for (const k of NUMERIC_FIELDS) {
      const raw = String(p[k] ?? "");
      if (raw === "") {
        p[k] = null;
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) return { ok: false, error: `"${k}" must be a valid number.` };
      p[k] = Math.round(n * 100) / 100;
    }
    return { ok: true, value: p };
  }

  async function doSave(
    e: FormEvent,
    section: "general" | "protection" | "notifications",
    build: () => Record<string, unknown>
  ) {
    e.preventDefault();
    setMsg({ general: "", protection: "", notifications: "" });
    const payload = build();
    const s = sanitize(payload);
    if (!s.ok) {
      setMsg((m) => ({ ...m, [section]: s.error }));
      return;
    }
    const r = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s.value) });
    const j = await r.json();
    setMsg((m) => ({ ...m, [section]: j.ok ? "Saved." : (j?.error?.message ?? "Failed") }));
  }

  async function doChangePassword(e: FormEvent) {
    e.preventDefault();
    setPw((p) => ({ ...p, busy: true, msg: "" }));
    if (pw.next.length < 8) {
      setPw((p) => ({ ...p, busy: false, msg: "New password must be at least 8 characters." }));
      return;
    }
    if (pw.next !== pw.confirm) {
      setPw((p) => ({ ...p, busy: false, msg: "New passwords do not match." }));
      return;
    }
    const r = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: pw.current, newPassword: pw.next }),
    });
    const j = await r.json().catch(() => ({}));
    setPw((p) => ({ ...p, busy: false, msg: j?.ok ? "Password changed." : (j?.error?.message ?? "Failed") }));
    if (j?.ok) setPw((p) => ({ ...p, current: "", next: "", confirm: "" }));
  }

  const fields: Array<[string, string, boolean]> = [
    ["name", "Business name", false],
    ["contactPhone", "Contact phone", false],
    ["address", "Address", false],
    ["returnPolicy", "Return policy", true],
    ["exchangePolicy", "Exchange policy", true],
    ["cancelPolicy", "Cancellation policy", true],
    ["shippingPolicy", "Shipping policy", true],
    ["minimumOrderAmount", "Minimum order (EGP)", false],
    ["freeDeliveryThreshold", "Free delivery over (EGP)", false],
    ["cartNudgeHours", "Cart reminder after hours (blank = off)", false],
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold tracking-tight">Settings</h1>
      <form onSubmit={(e) => doSave(e, "general", () => ({ ...form }))} className="card max-w-2xl space-y-4 p-6">
        {fields.map(([k, label, area]) => (
          <div key={k}>
            <label className="label">{label}</label>
            {area
              ? <textarea className="input min-h-[80px]" value={val(k)} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              : <input className="input" type={NUMERIC_FIELDS.has(k) ? "number" : "text"} value={val(k)} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />}
          </div>
        ))}
        <div className="flex items-center gap-3">
          <button className="btn-primary">Save settings</button>
          {msg.general && <span className={`text-sm ${msg.general.includes("must") || msg.general === "Failed" ? "text-red-700" : ""}`}>{msg.general}</span>}
        </div>
      </form>
      <form onSubmit={(e) => doSave(e, "protection", () => (verifyOn !== null ? { requirePhoneVerify: verifyOn } : {}))} className="card max-w-2xl space-y-4 p-6">
        <h2 className="font-bold">Order protection</h2>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={verifyChecked}
            onChange={(e) => setVerifyOn(e.target.checked)}
          />
          <span>
            <span className="font-semibold">Require SMS code before confirming COD orders.</span>
            <span className="block text-xs text-ink-500">Verifies the phone number is real. Customers get a 6-digit code valid 10 minutes, 5 attempts max.</span>
          </span>
        </label>
        <div className="flex items-center gap-3">
          <button className="btn-primary">Save protection</button>
          {msg.protection && <span className="text-sm">{msg.protection}</span>}
        </div>
      </form>
      <form
        onSubmit={(e) =>
          doSave(e, "notifications", () => ({
            notificationConfig: {
              ownerPhone: notify.ownerPhone || undefined,
              channel: notify.channel,
              webhookUrl: notify.webhookUrl || undefined,
            },
          }))
        }
        className="card max-w-2xl space-y-4 p-6"
      >
        <h2 className="font-bold">Owner notifications</h2>
        <p className="text-sm text-ink-500">Where new-order and escalation alerts are sent.</p>
        <div><label className="label">Owner phone (WhatsApp)</label><input className="input" value={notify.ownerPhone} onChange={(e) => setNotify({ ...notify, ownerPhone: e.target.value })} placeholder="+20 1XX XXX XXXX" /></div>
        <div><label className="label">Channel</label>
          <select className="input" value={notify.channel} onChange={(e) => setNotify({ ...notify, channel: e.target.value })}>
            <option value="console">Console log (for testing only)</option>
            <option value="whatsapp">WhatsApp to owner phone</option>
            <option value="webhook">Webhook POST (SMS gateway / Slack)</option>
          </select>
        </div>
        {notify.channel === "webhook" && (
          <div><label className="label">Webhook URL</label><input className="input" value={notify.webhookUrl} onChange={(e) => setNotify({ ...notify, webhookUrl: e.target.value })} placeholder="https://…" /></div>
        )}
        <div className="flex items-center gap-3">
          <button className="btn-primary">Save notifications</button>
          {msg.notifications && <span className="text-sm">{msg.notifications}</span>}
        </div>
      </form>
      <form onSubmit={doChangePassword} className="card max-w-2xl space-y-4 p-6">
        <h2 className="font-bold">Change password</h2>
        <p className="-mt-2 text-sm text-ink-500">Set a new password for your account. All sessions keep working until your next sign-in.</p>
        <div><label className="label">Current password</label><input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required autoComplete="current-password" /></div>
        <div><label className="label">New password (min 8 chars)</label><input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required minLength={8} autoComplete="new-password" /></div>
        <div><label className="label">Confirm new password</label><input className="input" type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required minLength={8} autoComplete="new-password" /></div>
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={pw.busy}>{pw.busy ? "…" : "Update password"}</button>
          {pw.msg && <span className={`text-sm ${pw.msg === "Password changed." ? "" : "text-red-700"}`}>{pw.msg}</span>}
        </div>
      </form>
    </div>
  );
}