"use client";
import { useState } from "react";
import { useApi, Loading, Err } from "@/components/ui";

interface ChannelStatus {
  configured: boolean;
  env: string[];
}

export default function Channels() {
  const { data, loading, error } = useApi<{ tenant: { slug: string }; channels: Record<string, ChannelStatus> }>("/api/channels/status");
  const [copied, setCopied] = useState<string | null>(null);
  if (loading) return <Loading />;
  if (error || !data) return <Err message={error || "Failed"} />;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const slug = data.tenant.slug;
  const waWebhook = `${origin}/api/channels/whatsapp?tenant=${slug}`;
  const igWebhook = `${origin}/api/channels/instagram?tenant=${slug}`;
  const msgrWebhook = `${origin}/api/channels/messenger?tenant=${slug}`;
  const status = data.channels;

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  function StatusBadge({ ok }: { ok: boolean }) {
    return ok ? <span className="badge-green">Connected</span> : <span className="badge-amber">Not configured</span>;
  }

  function ChannelCard({ title, description, configured, webhookUrl, setupHint }: { title: string; description: string; configured: boolean; webhookUrl: string; setupHint: string }) {
    return (
      <div className="card max-w-2xl space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold">{title}</h2>
            <p className="mt-1 text-sm text-ink-500">{description}</p>
          </div>
          <StatusBadge ok={configured} />
        </div>
        <div className="rounded-lg border border-ink-100 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Webhook URL</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-ink-50 p-2 font-mono text-xs">{webhookUrl}</code>
            <button onClick={() => copy(webhookUrl, title)} className="btn-ghost text-xs shrink-0">{copied === title ? "Copied \u2713" : "Copy"}</button>
          </div>
          <p className="mt-3 text-xs text-ink-500">{setupHint}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold tracking-tight">Channels</h1>
      <p className="text-sm text-ink-500">
        Connect where your customers chat. The AI sells on any active channel.
      </p>
      <ChannelCard
        title="WhatsApp (Meta Cloud API)"
        description="The official Meta integration for receiving and sending WhatsApp messages."
        configured={status.whatsapp?.configured ?? false}
        webhookUrl={waWebhook}
        setupHint="Paste this URL in your Meta app's webhook settings, then verify the connection."
      />
      <ChannelCard
        title="Instagram Messaging"
        description="Answers Instagram DMs automatically with your catalog and order flow."
        configured={status.instagram?.configured ?? false}
        webhookUrl={igWebhook}
        setupHint="Paste this URL in your Meta app's Instagram webhook settings, then verify the connection."
      />
      <ChannelCard
        title="Facebook Messenger"
        description="Handles Messenger chats just like WhatsApp and Instagram."
        configured={status.messenger?.configured ?? false}
        webhookUrl={msgrWebhook}
        setupHint="Paste this URL in your Meta app's Messenger webhook settings, then verify the connection."
      />
      <div className="card max-w-2xl space-y-3 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold">Website chat</h2>
            <p className="mt-1 text-sm text-ink-500">Embed a chat widget on your site that connects to the same AI.</p>
          </div>
          <StatusBadge ok={status.webchat?.configured ?? true} />
        </div>
        <p className="text-sm text-ink-500">
          Use the message endpoint to send and receive conversations from your website. Your AI agent behaves identically to the chat channels.
        </p>
      </div>
    </div>
  );
}