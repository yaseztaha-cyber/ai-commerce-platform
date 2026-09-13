"use client";
import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function ResetPasswordInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/auth/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !data.ok) {
      setError(data?.error?.message ?? "Request failed");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <main className="mx-auto max-w-md px-6 py-16">
        <div className="card p-6 text-center">
          <h1 className="text-xl font-extrabold tracking-tight">Password updated</h1>
          <p className="mt-1 text-sm text-ink-500">You can now sign in with your new password.</p>
          <Link className="btn-primary mt-4 block w-full text-center" href="/login">Sign in</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <Link href="/login" className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-ink-900 text-sm font-bold text-white">Y</div>
        <span className="font-bold tracking-tight">YASEZ Commerce</span>
      </Link>
      <h1 className="mt-6 text-2xl font-extrabold tracking-tight">Choose a new password</h1>
      <p className="mt-1 text-sm text-ink-500">Make it at least 8 characters.</p>
      <form onSubmit={submit} className="card mt-6 space-y-4 p-6">
        {!token && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">Missing reset token. Request a new reset link.</p>}
        <div>
          <label className="label">New password</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
        </div>
        <div>
          <label className="label">Confirm password</label>
          <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} autoComplete="new-password" />
        </div>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <button className="btn-primary w-full" disabled={busy || !token}>{busy ? "…" : "Set password"}</button>
      </form>
    </main>
  );
}

export default function ResetPassword() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md px-6 py-16" />}>
      <ResetPasswordInner />
    </Suspense>
  );
}