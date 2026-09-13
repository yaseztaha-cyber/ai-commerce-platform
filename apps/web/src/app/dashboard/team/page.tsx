"use client";
import { useState, type FormEvent } from "react";
import { useApi, Loading, Err } from "@/components/ui";

const ROLES = ["OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER"];

interface Member { id: string; role: string; user: { email: string; name?: string | null } }
interface Invite { id: string; email: string; role: string; expiresAt: string; createdAt: string }

export default function Team() {
  const { data, loading, error } = useApi<{ members: Member[]; invites: Invite[] }>("/api/team");
  const [form, setForm] = useState({ email: "", role: "AGENT" });
  const [msg, setMsg] = useState("");
  const [lastToken, setLastToken] = useState("");
  const [localInvites, setLocalInvites] = useState<Invite[]>([]);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setMsg("");
    setLastToken("");
    const r = await fetch("/api/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const j = await r.json();
    if (!j.ok) {
      setMsg(j?.error?.message ?? "Failed to create invite");
      return;
    }
    const inv = j.data.invite;
    setLastToken(inv.token);
    setLocalInvites((prev) => [{ id: inv.id, email: inv.email, role: inv.role, expiresAt: inv.expiresAt, createdAt: new Date().toISOString() }, ...prev]);
    setForm({ email: "", role: "AGENT" });
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this invite?")) return;
    const r = await fetch(`/api/team/invites/${id}`, { method: "DELETE" });
    if (r.ok) {
      setLocalInvites((prev) => prev.filter((i) => i.id !== id));
    }
  }

  if (loading) return <Loading />;
  if (error || !data) return <Err message={error || "You don't have permission to manage the team."} />;

  const allInvites = [...localInvites.filter((li) => !data.invites.some((d) => d.id === li.id)), ...data.invites];
  const acceptUrl = (token: string) => `${window.location.origin}/accept-invite?token=${token}`;
  const copyToClipboard = (text: string) => navigator.clipboard.writeText(text);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold tracking-tight">Team</h1>
      <div className="card overflow-x-auto">
        <div className="border-b border-ink-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Members</div>
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
          <tbody>
            {data.members.map((m) => (
              <tr key={m.id}><td className="font-semibold">{m.user.name ?? "—"}</td><td className="font-mono text-xs">{m.user.email}</td><td><span className="badge-gray">{m.role}</span></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <form onSubmit={invite} className="card flex flex-wrap items-end gap-3 p-4">
        <div><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
        <div><label className="label">Role</label>
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <button className="btn-primary">Send invite</button>
        {msg && <span className="text-sm text-red-700">{msg}</span>}
      </form>
      {lastToken && (
        <div className="card border-brand-100 bg-brand-50 p-4 text-sm">
          <div className="font-semibold text-brand-700">Invite link (share once)</div>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-white p-2 font-mono text-xs border border-brand-100">{acceptUrl(lastToken)}</code>
            <button
              className="btn-ghost text-xs shrink-0"
              onClick={() => copyToClipboard(acceptUrl(lastToken))}
            >
              Copy
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-400">This link expires in 7 days. It can only be used once.</p>
        </div>
      )}
      <div className="card overflow-x-auto">
        <div className="border-b border-ink-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Pending invites</div>
        {allInvites.length === 0 ? <p className="p-4 text-sm text-ink-300">No pending invites.</p> : (
          <table className="table">
            <thead><tr><th>Email</th><th>Role</th><th>Expires</th><th></th></tr></thead>
            <tbody>
              {allInvites.map((i) => (
                <tr key={i.id}>
                  <td className="font-mono text-xs">{i.email}</td>
                  <td><span className="badge-gray">{i.role}</span></td>
                  <td className="text-xs text-ink-500">{new Date(i.expiresAt).toLocaleString()}</td>
                  <td>
                    <button className="text-xs text-red-700 hover:underline" onClick={() => revoke(i.id)}>Revoke</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}