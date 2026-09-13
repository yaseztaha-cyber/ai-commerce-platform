"use client";
import { useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export function AuthForm({ mode, demoHint }: { mode: "login" | "register"; demoHint?: string }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", businessName: "", industry: "CLOTHING" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const url = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    const body = mode === "login" ? { email: form.email, password: form.password } : form;
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !data.ok) {
      setError(data?.error?.message ?? "Request failed");
      return;
    }
    router.push("/dashboard");
  }

  const set = (k: string) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <Link href="/" className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-ink-900 text-sm font-bold text-white">Y</div>
        <span className="font-bold tracking-tight">YASEZ Commerce</span>
      </Link>
      <h1 className="mt-6 text-2xl font-extrabold tracking-tight">{mode === "login" ? "Sign in" : "Create your store"}</h1>
      <p className="mt-1 text-sm text-ink-500">
        {mode === "login" ? "Access your business dashboard." : "Account + business in one step."}
        {demoHint && <span className="mt-1 block rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">Dev environment: {demoHint}</span>}
      </p>
      <form onSubmit={submit} className="card mt-6 space-y-4 p-6">
        {mode === "register" && (
          <>
            <div><label className="label" htmlFor="auth-name">Your name</label><input id="auth-name" className="input" autoComplete="name" value={form.name} onChange={set("name")} required /></div>
            <div><label className="label" htmlFor="auth-business">Business name</label><input id="auth-business" className="input" autoComplete="organization" value={form.businessName} onChange={set("businessName")} required placeholder="e.g. Cairo Boutique" /></div>
            <div>
              <label className="label" htmlFor="auth-industry">Industry</label>
              <select id="auth-industry" className="input" value={form.industry} onChange={set("industry")}>
                <option value="CLOTHING">Clothing</option>
                <option value="RESTAURANT">Restaurant</option>
                <option value="BEAUTY">Beauty salon</option>
                <option value="ELECTRONICS">Electronics</option>
                <option value="FURNITURE">Furniture</option>
                <option value="SERVICES">Services</option>
              </select>
            </div>
          </>
        )}
        <div><label className="label" htmlFor="auth-email">Email</label><input id="auth-email" className="input" type="email" autoComplete="email" value={form.email} onChange={set("email")} required /></div>
        <div>
          <div className="flex items-center justify-between">
            <label className="label" htmlFor="auth-password">Password</label>
            {mode === "login" && (
              <Link className="text-xs font-semibold text-ink-500 hover:text-ink-900" href="/forgot-password">Forgot password?</Link>
            )}
          </div>
          <input id="auth-password" className="input" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={form.password} onChange={set("password")} required minLength={8} />
        </div>
        {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? (mode === "login" ? "Signing in…" : "Creating your store…") : mode === "login" ? "Sign in" : "Create store"}</button>
        <p className="text-center text-sm text-ink-500">
          {mode === "login" ? <>No account? <Link className="font-semibold text-ink-900" href="/register">Register</Link></> : <>Have an account? <Link className="font-semibold text-ink-900" href="/login">Sign in</Link></>}
        </p>
      </form>
    </main>
  );
}
