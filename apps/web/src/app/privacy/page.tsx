import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy Policy" };

const H = "mt-8 text-lg font-bold";
const P = "mt-2 text-sm leading-6 text-ink-600";
const LI = "mt-1 text-sm leading-6 text-ink-600";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link className="text-sm text-brand-700 hover:underline" href="/">← YASEZ Commerce</Link>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-ink-400">Last updated: September 2026</p>

      <h2 className={H}>Who controls what</h2>
      <p className={P}>
        If you are a <strong>merchant</strong>, you control your shoppers&apos; data and we process
        it for you. If you are a <strong>shopper</strong> chatting with a store powered by YASEZ
        Commerce, direct privacy requests to that store — they decide what happens to your data.
        YASEZ Commerce itself controls merchant account data as described below.
      </p>

      <h2 className={H}>Data we store</h2>
      <ul className="list-disc pl-6">
        <li className={LI}><strong>Account:</strong> name, email, phone, role; passwords exist only as bcrypt hashes.</li>
        <li className={LI}><strong>Store content you enter:</strong> products, variants, inventory, customers, orders, promotions, knowledge documents, and team inbox conversations.</li>
        <li className={LI}><strong>Shopper messages</strong> on connected channels (WhatsApp, Instagram, Messenger), including voice-note transcripts and photo readings used to answer — body measurements stay in the chat transcript only and never enter profiles or analytics.</li>
        <li className={LI}><strong>Verification codes</strong> exist only as SHA-256 hashes bound to one order, expiring in 10 minutes; raw codes are never stored or logged.</li>
        <li className={LI}><strong>Payments:</strong> plan, status, and Fawry payment references/amounts. Card numbers never touch our servers.</li>
        <li className={LI}><strong>Product images</strong> you upload (local volume or your object-storage bucket).</li>
        <li className={LI}><strong>Technical logs:</strong> request IDs, error traces, and usage counters. Secrets are redacted before logging; error responses never carry stack traces or credentials.</li>
      </ul>

      <h2 className={H}>Services that touch data (server-side only)</h2>
      <ul className="list-disc pl-6">
        <li className={LI}>Hosting database (Postgres) and queue (Redis) run by the deployment operator.</li>
        <li className={LI}>Meta WhatsApp/Instagram/Messenger Cloud APIs — message delivery.</li>
        <li className={LI}>Fawry — subscription payments. Bosta — shipping labels you request.</li>
        <li className={LI}>AI providers (LLM, transcription, vision) — drafting replies from your catalog; media is never sent to the language model directly.</li>
        <li className={LI}>Email delivery (SMTP/Resend) — password resets and renewal notices.</li>
      </ul>
      <p className={P}>We run no advertising trackers. The only cookie is the essential HttpOnly session cookie.</p>

      <h2 className={H}>Erasure and retention</h2>
      <ul className="list-disc pl-6">
        <li className={LI}><strong>Customers:</strong> dashboard delete anonymizes PII (name → “Deleted customer”, contacts cleared) while preserving order price snapshots for accounting.</li>
        <li className={LI}><strong>Conversations and knowledge documents:</strong> deletable with their messages, tool calls, and embeddings.</li>
        <li className={LI}><strong>Full workspace deletion</strong> is an operator procedure (contact support); product images in object storage are removed by prefix.</li>
        <li className={LI}>Audit logs (who did what, when) and stock/order lifecycle ledgers are retained for integrity and abuse investigation, without personal content.</li>
      </ul>

      <h2 className={H}>Security</h2>
      <p className={P}>
        TLS terminates at the deployment proxy, sessions are HttpOnly + SameSite cookies (Secure on
        https), mutating APIs are rate-limited, channel webhooks are signature-verified, and
        databases are covered by the backup procedure in our deployment docs. No system is
        perfectly secure — report suspected issues through the support channel provided at signup
        and we will respond.
      </p>

      <h2 className={H}>Your rights and changes</h2>
      <p className={P}>
        Merchants can access, correct, and erase their data through the dashboard flows above or via
        support. Shoppers should contact the store they chatted with. We may update this policy as
        the product evolves; material changes are announced in the dashboard.
      </p>
    </main>
  );
}
