"use client";
import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

function AcceptForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [form, setForm] = useState({ name: "", password: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token) {
      setMsg("Missing invite token.");
      return;
    }
    setBusy(true);
    setMsg("");
    const r = await fetch("/api/team/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, name: form.name || undefined, password: form.password || undefined }),
    });
    const j = await r.json();
    setBusy(false);
    if (!j.ok) {
      setMsg(j?.error?.message ?? "Invite invalid or expired.");
      return;
    }
    router.push("/login");
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <Link href="/" className="text-sm text-ink-500 hover:text-ink-900">← Back</Link>
      <h1 className="mt-4 text-2xl font-extrabold tracking-tight">Join your team</h1>
      <p className="mt-1 text-sm text-ink-500">
        {token ? "Accept the invitation below. New here? set a password. Already have an account with the invited email? just accept." : "This page needs an invite link from your workspace admin."}
      </p>
      <form onSubmit={submit} className="card mt-6 space-y-4 p-6">
        <div><label className="label">Your name (new accounts)</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><label className="label">Password (new accounts, min 8)</label><input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
        {msg && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{msg}</p>}
        <button className="btn-primary w-full" disabled={busy || !token}>{busy ? "…" : "Accept invite"}</button>
      </form>
    </main>
  );
}

export default function AcceptInvite() {
  return (
    <Suspense>
      <AcceptForm />
    </Suspense>
  );
}
