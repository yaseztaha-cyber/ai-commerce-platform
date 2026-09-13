import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms of Service" };

const H = "mt-8 text-lg font-bold";
const P = "mt-2 text-sm leading-6 text-ink-600";

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link className="text-sm text-brand-700 hover:underline" href="/">← YASEZ Commerce</Link>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Terms of Service</h1>
      <p className="mt-2 text-sm text-ink-400">Last updated: September 2026</p>

      <h2 className={H}>1. The service</h2>
      <p className={P}>
        YASEZ Commerce is a multi-tenant commerce platform for small businesses: it connects your
        WhatsApp, Instagram, and Messenger channels to an AI sales assistant backed by your real
        catalog, inventory, orders, and team inbox. You manage your store from the merchant dashboard.
      </p>

      <h2 className={H}>2. Accounts and roles</h2>
      <p className={P}>
        You register with an email and password and create one workspace (tenant). The workspace
        owner can invite seats with the manager role. You are responsible for keeping credentials
        secret and for everything done under your seats. Tell us promptly about any suspected
        compromise so we can help lock the account down.
      </p>

      <h2 className={H}>3. Plans and billing</h2>
      <p className={P}>
        Paid plans (Growth, Scale) are billed monthly in Egyptian pounds through Fawry&apos;s hosted
        payment page — we never see or store your card numbers, only Fawry&apos;s payment reference
        and amount. Subscriptions renew every 30 days. If a renewal fails, the workspace is marked
        past-due (with a grace notice to the owner) and may be suspended until payment succeeds.
        Starter is free. You can change or stop paid plans from Dashboard → Billing; access continues
        until the end of the paid period.
      </p>

      <h2 className={H}>4. Your responsibilities</h2>
      <p className={P}>
        Keep your catalog, prices, stock, and AI settings accurate — the assistant answers shoppers
        from exactly what you enter. Sell only lawful goods, honor Meta&apos;s messaging policies on
        every connected channel (no spam, no unsolicited bulk messaging), and obtain any consent your
        business needs before contacting shoppers. You remain responsible for fulfilling the orders
        the platform records for you.
      </p>

      <h2 className={H}>5. AI-assisted messaging</h2>
      <p className={P}>
        Replies are drafted by AI models from your catalog, documents, and settings, with guardrails
        (real stock checks, order confirmation, human handoff when unsure). AI output can be wrong:
        review important conversations in the inbox and use human takeover whenever accuracy matters.
      </p>

      <h2 className={H}>6. Suspension and termination</h2>
      <p className={P}>
        We may suspend a workspace that abuses the service, breaks channel policies, misses payment
        past grace, or creates legal risk — normally after notice to the owner. You may stop using
        the service at any time; data erasure works as described in the Privacy Policy.
      </p>

      <h2 className={H}>7. Liability</h2>
      <p className={P}>
        To the maximum extent permitted by law, YASEZ Commerce is not liable for indirect or
        consequential losses (including lost sales from downtime or AI mistakes). Our total liability
        for any workspace is limited to the subscription fees that workspace paid in the three months
        before the claim.
      </p>

      <h2 className={H}>8. Changes and contact</h2>
      <p className={P}>
        We may update these terms as the product evolves; material changes are announced in the
        dashboard and continued use means acceptance. These terms are governed by the laws of Egypt.
        Questions: reach YASEZ Commerce support through the channel provided at signup.
      </p>
    </main>
  );
}
