"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !data.ok) {
      setError(data?.error?.message ?? "Request failed");
      return;
    }
    setSent(true);
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <Link href="/login" className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-ink-900 text-sm font-bold text-white">Y</div>
        <span className="font-bold tracking-tight">YASEZ Commerce</span>
      </Link>
      <h1 className="mt-6 text-2xl font-extrabold tracking-tight">Reset your password</h1>
      <p className="mt-1 text-sm text-ink-500">We&apos;ll email you a secure reset link.</p>
      <form onSubmit={submit} className="card mt-6 space-y-4 p-6">
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        {sent ? (
          <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
            If an account exists for that email, a reset link is on its way. Check your inbox (and spam).
          </div>
        ) : (
          <button className="btn-primary w-full" disabled={busy}>{busy ? "…" : "Send reset link"}</button>
        )}
        <p className="text-center text-sm text-ink-500">
          Remembered it? <Link className="font-semibold text-ink-900" href="/login">Sign in</Link>
        </p>
      </form>
    </main>
  );
}