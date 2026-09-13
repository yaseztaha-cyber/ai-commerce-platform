"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";

export function useApi<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch(url)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j?.error?.message ?? "Failed");
        setData(j.data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [url]);
  return { data, loading, error };
}

/** 1234567 -> "1,234,567". Keeps dashboard money readable at scale. */
export function formatNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-EG", { maximumFractionDigits: 2 }).format(n);
}

export function formatEGP(n: number | null | undefined, currency = "EGP"): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${formatNum(n)} ${currency}`;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function Stat({ label, value, href, sub }: { label: string; value: string | number; href?: string; sub?: string }) {
  const inner = (
    <div className="card p-4 transition-colors hover:border-ink-300">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</div>
      <div className="mt-1 text-2xl font-extrabold tabular-nums tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-300">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 rounded-lg">{inner}</Link> : inner;
}

export function Skeleton({ lines = 4, label = "Loading" }: { lines?: number; label?: string }) {
  return (
    <div className="card space-y-3 p-5" role="status" aria-label={label}>
      <div className="h-4 w-1/3 animate-pulse rounded bg-ink-100" />
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-3 animate-pulse rounded bg-ink-50" style={{ width: `${92 - i * 7}%` }} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="card p-5" role="status" aria-label="Loading table">
      <div className="animate-pulse space-y-3">
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {Array.from({ length: cols }, (_, i) => (
            <div key={i} className="h-4 w-3/4 rounded bg-ink-100" />
          ))}
        </div>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="grid gap-4 border-t border-ink-100 pt-3" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
            {Array.from({ length: cols }, (_, i) => (
              <div key={i} className="h-4 w-full rounded bg-ink-50" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card p-5 animate-pulse space-y-3" role="status" aria-label="Loading card">
      <div className="h-5 w-1/4 rounded bg-ink-100" />
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-4 w-full rounded bg-ink-50" />
      ))}
    </div>
  );
}

export function SkeletonStat() {
  return (
    <div className="card p-4 animate-pulse" role="status" aria-label="Loading stat">
      <div className="h-3 w-1/3 rounded bg-ink-100" />
      <div className="mt-2 h-8 w-1/2 rounded bg-ink-50" />
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <Skeleton lines={4} label={label} />;
}

export function LoadingTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return <SkeletonTable rows={rows} cols={cols} />;
}

export function LoadingCards({ count = 4, lines = 3 }: { count?: number; lines?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" role="status" aria-label="Loading cards">
      {Array.from({ length: count }, (_, i) => <SkeletonCard key={i} lines={lines} />)}
    </div>
  );
}

export function Err({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
      <span className="font-semibold">Something went wrong. </span>
      {message}
      {retry && (
        <button onClick={retry} className="ms-2 font-semibold underline hover:no-underline">
          Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ title, hint, actionHref, actionLabel, icon }: { title: string; hint?: string; actionHref?: string; actionLabel?: string; icon?: React.ReactNode }) {
  return (
    <div className="card p-10 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-ink-50 text-lg text-ink-300">
        {icon ?? <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
      </div>
      <div className="font-semibold text-lg">{title}</div>
      {hint && <div className="mx-auto mt-2 max-w-md text-sm text-ink-500">{hint}</div>}
      {actionHref && actionLabel && (
        <Link href={actionHref} className="btn-primary mt-5 text-xs">
          {actionLabel}
        </Link>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_CONFIRMATION: "Confirming",
  CONFIRMED: "Confirmed",
  PROCESSING: "Processing",
  READY: "Ready",
  OUT_FOR_DELIVERY: "Out for delivery",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
  RETURNED: "Returned",
  REFUNDED: "Refunded",
  AI_ACTIVE: "AI active",
  HUMAN_REQUIRED: "Needs human",
  HUMAN_ACTIVE: "Human active",
  RESOLVED: "Resolved",
  SPAM: "Spam",
  SENT: "Sent",
  QUEUED: "Queued",
  SKIPPED: "Skipped",
};

export function humanizeStatus(status: string): string {
  if (STATUS_LABEL[status]) return STATUS_LABEL[status];
  return status.toLowerCase().split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export function StatusBadge({ status }: { status: string }) {
  const cls =
    ["CONFIRMED", "COMPLETED", "RESOLVED", "SENT", "AI_ACTIVE"].includes(status) ? "badge-green"
    : ["CANCELLED", "FAILED", "SPAM"].includes(status) ? "badge-red"
    : ["HUMAN_REQUIRED", "PENDING_CONFIRMATION", "QUEUED"].includes(status) ? "badge-amber"
    : "badge-gray";
  return <span className={cls}>{humanizeStatus(status)}</span>;
}

/** Form field with label, error, hint, and optional tooltip */
export interface FormFieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  tooltip?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function FormField({ label, htmlFor, error, hint, tooltip, required, children, className }: FormFieldProps) {
  const tooltipId = htmlFor ? `${htmlFor}-tooltip` : undefined;
  return (
    <div className={`relative ${className || ""}`}>
      <label className="label" htmlFor={htmlFor}>
        {label}
        {required && <span className="text-red-500 ms-0.5" aria-hidden="true">*</span>}
        {tooltip && tooltipId && (
          <button
            type="button"
            className="ms-1 text-ink-300 hover:text-ink-500"
            aria-label="More info"
            aria-describedby={tooltipId}
            onMouseEnter={() => showTooltip(tooltipId, tooltip)}
            onMouseLeave={() => hideTooltip(tooltipId)}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </button>
        )}
      </label>
      {tooltip && tooltipId && (
        <div id={tooltipId} className="absolute z-20 hidden px-3 py-2 text-xs bg-ink-900 text-white rounded shadow-lg max-w-xs whitespace-normal" role="tooltip">
          {tooltip}
        </div>
      )}
      <div>{children}</div>
      {error && <p className="mt-1 text-sm text-red-600" role="alert">{error}</p>}
      {hint && !error && <p className="mt-1 text-sm text-ink-500">{hint}</p>}
    </div>
  );
}

function showTooltip(id: string, content: string) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = content;
    el.classList.remove("hidden");
    // Position near the trigger
    const trigger = document.querySelector(`[aria-describedby="${id}"]`) as HTMLElement;
    if (trigger) {
      const rect = trigger.getBoundingClientRect();
      el.style.top = `${rect.bottom + 4}px`;
      el.style.left = `${rect.left}px`;
    }
  }
}

function hideTooltip(id: string) {
  const el = document.getElementById(id);
  if (el) el.classList.add("hidden");
}

/** Input with validation states */
export interface ValidatedInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  hint?: string;
  tooltip?: string;
  label?: string;
  required?: boolean;
}

export function ValidatedInput({ error, hint, tooltip, label, required, className, id, ...props }: ValidatedInputProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");
  const errorId = error ? `${inputId}-error` : undefined;
  const hintId = hint && !error ? `${inputId}-hint` : undefined;

  return (
    <FormField label={label || ""} htmlFor={inputId} error={error} hint={hint} tooltip={tooltip} required={required}>
      <input
        id={inputId}
        className={`input ${error ? "border-red-300 focus:border-red-500 focus:ring-red-500" : ""} ${className || ""}`}
        aria-invalid={error ? "true" : "false"}
        aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
        {...props}
      />
    </FormField>
  );
}

/** Select with validation states */
export interface ValidatedSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
  hint?: string;
  tooltip?: string;
  label?: string;
  required?: boolean;
  options: Array<{ value: string; label: string }>;
}

export function ValidatedSelect({ error, hint, tooltip, label, required, options, className, id, ...props }: ValidatedSelectProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");
  const errorId = error ? `${inputId}-error` : undefined;
  const hintId = hint && !error ? `${inputId}-hint` : undefined;

  return (
    <FormField label={label || ""} htmlFor={inputId} error={error} hint={hint} tooltip={tooltip} required={required}>
      <select
        id={inputId}
        className={`input ${error ? "border-red-300 focus:border-red-500 focus:ring-red-500" : ""} ${className || ""}`}
        aria-invalid={error ? "true" : "false"}
        aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
        {...props}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </FormField>
  );
}

/** Textarea with validation states */
export interface ValidatedTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
  hint?: string;
  tooltip?: string;
  label?: string;
  required?: boolean;
}

export function ValidatedTextarea({ error, hint, tooltip, label, required, className, id, ...props }: ValidatedTextareaProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");
  const errorId = error ? `${inputId}-error` : undefined;
  const hintId = hint && !error ? `${inputId}-hint` : undefined;

  return (
    <FormField label={label || ""} htmlFor={inputId} error={error} hint={hint} tooltip={tooltip} required={required}>
      <textarea
        id={inputId}
        className={`input ${error ? "border-red-300 focus:border-red-500 focus:ring-red-500" : ""} ${className || ""}`}
        aria-invalid={error ? "true" : "false"}
        aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
        {...props}
      />
    </FormField>
  );
}
