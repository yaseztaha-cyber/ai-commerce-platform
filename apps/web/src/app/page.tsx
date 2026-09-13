import Link from "next/link";

const features = [
  {
    t: "Automatic customer replies",
    d: "Answers in Arabic & English, 24/7, in your brand voice.",
    icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
  },
  {
    t: "Real stock & price checks",
    d: "Every claim comes from your live inventory — never invented.",
    icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
  },
  {
    t: "Order confirmation flow",
    d: "Collects variant, address & payment, then confirms transactionally.",
    icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
  },
  {
    t: "Human handoff",
    d: "Escalates complaints, refunds & edge cases to your team instantly.",
    icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
  },
  {
    t: "Live inbox & analytics",
    d: "Take over chats, track conversion, failures and revenue.",
    icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
  },
  {
    t: "Integrations",
    d: "WhatsApp Cloud API, Instagram & Messenger, webhooks for n8n & CRMs.",
    icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
  },
];

const demo = [
  { who: "Customer", text: "عايز تيشيرت اوفرسايز اسود مقاس L" },
  { who: "AI", text: "الأوردر:\n\nتيشيرت أوفرسايز — Black / L — ×1\nالسعر حسب الكتالوج + الشحن حسب منطقتك\nأأكد الأوردر؟" },
  { who: "Customer", text: "اكد" },
  { who: "AI", text: "تم تأكيد الأوردر ✅ المتجر هيبدأ تجهيزه فورًا." },
];

const plans = [
  {
    n: "Starter",
    p: "Free",
    f: ["200 AI chats / month", "50 products", "2 team seats", "WhatsApp + webchat"],
    popular: false,
  },
  {
    n: "Growth",
    p: "499 EGP/mo",
    f: ["5,000 AI chats / month", "500 products", "5 team seats", "All channels + analytics"],
    popular: true,
  },
  {
    n: "Scale",
    p: "1999 EGP/mo",
    f: ["Unlimited AI chats", "Unlimited products & seats", "Everything in Growth"],
    popular: false,
  },
];

export default function Landing() {
  return (
    <main className="mx-auto max-w-7xl px-6">
      <header className="flex items-center justify-between py-6">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-ink-900 font-bold text-white">Y</div>
          <span className="text-lg font-bold tracking-tight">YASEZ Commerce</span>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <Link className="text-ink-500 hover:text-ink-900" href="/login">Sign in</Link>
          <Link className="btn-primary" href="/register">Start free</Link>
        </nav>
      </header>

      <section className="relative py-20 md:py-28">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-brand-50/50 via-transparent to-transparent" aria-hidden="true" />
        <div className="relative grid gap-10 py-6 md:grid-cols-2 md:items-center">
          <div>
            <p className="mb-3 inline-block rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
              AI SALES AGENT FOR SMALL BUSINESSES
            </p>
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight md:text-5xl lg:text-6xl">
              AI that turns customer messages into <span className="text-brand-700">completed orders</span>.
            </h1>
            <p className="mt-5 text-lg text-ink-500 max-w-xl">
              Connect WhatsApp. The agent checks real stock, answers in Arabic & English,
              confirms orders and hands off to humans when needed.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link className="btn-brand text-base px-6 py-3" href="/register">
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                Create your store
              </Link>
              <Link className="btn-ghost text-base px-6 py-3" href="/login">Open dashboard</Link>
            </div>
            <div className="mt-6 flex items-center gap-6 text-sm text-ink-500">
              <div className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-brand-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                No credit card required
              </div>
              <div className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-brand-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                Start free today
              </div>
              <div className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-brand-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                Cancel anytime
              </div>
            </div>
          </div>
          <div className="card overflow-hidden relative">
            <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-br from-brand-50 to-transparent opacity-50" aria-hidden="true" />
            <div className="relative border-b border-ink-100 bg-ink-50 px-4 py-2 text-xs font-semibold text-ink-500">SAMPLE CONVERSATION</div>
            <div className="space-y-3 p-4">
              {demo.map((m, i) => (
                <div key={i} className={`flex ${m.who === "Customer" ? "justify-end" : "justify-start"}`}>
                  <div dir="auto" className={`max-w-[85%] whitespace-pre-line rounded-lg px-3 py-2 text-sm ${m.who === "Customer" ? "bg-ink-900 text-white" : "border border-ink-100 bg-white"}`}>
                    <div className="mb-0.5 text-[11px] font-semibold opacity-60">{m.who}</div>
                    {m.text}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-16" aria-labelledby="features-heading">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 id="features-heading" className="text-3xl font-extrabold tracking-tight md:text-4xl">
            Everything you need to <span className="text-brand-700">sell on chat</span>
          </h2>
          <p className="mt-3 text-lg text-ink-500">
            Built for Egyptian businesses selling on WhatsApp, Instagram & Messenger.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <article key={f.t} className="card p-6 hover:border-brand-200 transition-colors">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700 mb-4">
                {f.icon}
              </div>
              <h3 className="font-semibold text-lg">{f.t}</h3>
              <p className="mt-2 text-sm text-ink-500">{f.d}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="my-10 rounded-2xl border border-brand-100 bg-brand-50/40 p-8 md:p-12" aria-labelledby="promise-heading">
        <div className="text-center max-w-3xl mx-auto">
          <h2 id="promise-heading" className="text-2xl font-extrabold tracking-tight md:text-3xl">
            Built for how real Egyptian stores sell
          </h2>
          <p className="mt-4 text-ink-600">
            Cash on delivery, size swaps, "بكام؟" price questions, and late-night orders —
            that&apos;s where other tools give up and the YASEZ agent shines.
          </p>
          <ul className="mt-8 grid gap-4 text-left sm:grid-cols-2 text-sm text-ink-600">
            <li className="rounded-lg bg-white p-4 shadow-sm">
              <strong className="block font-semibold text-ink-900">Never invents pricing</strong>
              Prices, stock and delivery fees always come from your catalog and settings.
            </li>
            <li className="rounded-lg bg-white p-4 shadow-sm">
              <strong className="block font-semibold text-ink-900">Handles the messy questions</strong>
              "ينفع تستبدل؟", "تحصيل عند الاستلام؟", "هوصل امتى؟" — answered from your rules.
            </li>
            <li className="rounded-lg bg-white p-4 shadow-sm">
              <strong className="block font-semibold text-ink-900">Humans take over when it matters</strong>
              Refunds and complaints escalate to your team with full context.
            </li>
            <li className="rounded-lg bg-white p-4 shadow-sm">
              <strong className="block font-semibold text-ink-900">Everything is recorded</strong>
              Every conversation, tool use and order step is logged and reportable.
            </li>
          </ul>
        </div>
      </section>

      <section className="card my-10 p-8 md:p-12" aria-labelledby="how-it-works-heading">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <h2 id="how-it-works-heading" className="text-3xl font-extrabold tracking-tight md:text-4xl">
            Get live in <span className="text-brand-700">4 steps</span>
          </h2>
          <p className="mt-3 text-lg text-ink-500">
            From zero to selling in under 15 minutes.
          </p>
        </div>
        <ol className="grid gap-4 md:grid-cols-4">
          {[
            { step: 1, title: "Add products", desc: "Create products, variants & stock in minutes with bulk tools" },
            { step: 2, title: "Set delivery", desc: "Configure zones, fees & payment methods" },
            { step: 3, title: "Connect WhatsApp", desc: "Paste webhook URL into Meta — done" },
            { step: 4, title: "AI sells", desc: "The agent handles chats, you fulfil orders" },
          ].map((s) => (
            <li key={s.title} className="relative rounded-lg border border-ink-100 bg-white p-6">
              <span className="absolute -top-3 left-4 flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-white text-sm font-bold">
                {s.step}
              </span>
              <div className="pt-6">
                <h3 className="font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-ink-500">{s.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="card my-10 p-8 md:p-12" aria-labelledby="pricing-heading">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <h2 id="pricing-heading" className="text-3xl font-extrabold tracking-tight md:text-4xl">
            Simple, <span className="text-brand-700">transparent pricing</span>
          </h2>
          <p className="mt-3 text-lg text-ink-500">
            Usage-based plans with limits enforced server-side. No hidden fees.
          </p>
        </div>
        <div className="mt-4 grid gap-6 md:grid-cols-3">
          {plans.map((t) => (
            <div key={t.n} className={`relative rounded-xl border p-6 ${t.popular ? "border-brand-300 bg-brand-50/30" : "border-ink-100"}`}>
              {t.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="px-3 py-0.5 text-xs font-semibold text-white bg-brand-600 rounded-full">Most Popular</span>
                </div>
              )}
              <div className="text-sm font-semibold text-ink-500">{t.n}</div>
              <div className="mt-1 text-3xl font-extrabold">{t.p}</div>
              <ul className="mt-4 space-y-2 text-sm text-ink-600">
                {t.f.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <svg className="w-4 h-4 mt-0.5 text-brand-600 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                <Link className={`btn-brand w-full ${!t.popular ? "btn-ghost" : ""}`} href="/register">
                  Start free
                </Link>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-ink-400">
          All plans include WhatsApp, Instagram &amp; Messenger channels. Starter is free forever — upgrade to Growth or Scale when you need more.
        </p>
      </section>

      <section className="py-12" aria-labelledby="cta-heading">
        <div className="mx-auto max-w-3xl text-center">
          <h2 id="cta-heading" className="text-3xl font-extrabold tracking-tight md:text-4xl">
            Ready to automate your sales?
          </h2>
          <p className="mt-4 text-lg text-ink-500">
            Create your store in minutes. No credit card required.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link className="btn-brand text-base px-8 py-3" href="/register">
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
              Create your free store
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-ink-100 py-8 text-xs text-ink-300">
        <div className="mx-auto max-w-7xl px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-ink-900 font-bold text-white">Y</div>
            <span className="font-bold tracking-tight">YASEZ Commerce</span>
          </div>
          <p>© 2026 YASEZ Commerce. WhatsApp integration uses the official Meta Cloud API.</p>
          <nav className="flex gap-6">
            <Link className="hover:text-ink-600" href="/terms">Terms</Link>
            <Link className="hover:text-ink-600" href="/privacy">Privacy</Link>
            <Link className="hover:text-ink-600" href="/register">Get started</Link>
            <Link className="hover:text-ink-600" href="/login">Sign in</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}