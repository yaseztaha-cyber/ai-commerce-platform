"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

const GROUPS: Array<{ title?: string; items: Array<[string, string]> }> = [
  {
    items: [["Overview", "/dashboard"]],
  },
  {
    title: "Sell",
    items: [
      ["Inbox", "/dashboard/inbox"],
      ["Orders", "/dashboard/orders"],
    ],
  },
  {
    title: "Catalog",
    items: [
      ["Products", "/dashboard/products"],
      ["Inventory", "/dashboard/inventory"],
      ["Customers", "/dashboard/customers"],
    ],
  },
  {
    title: "AI",
    items: [
      ["Playground", "/dashboard/playground"],
      ["Knowledge", "/dashboard/knowledge"],
      ["AI Settings", "/dashboard/ai-settings"],
    ],
  },
  {
    title: "Business",
    items: [
      ["Channels", "/dashboard/channels"],
      ["Promotions", "/dashboard/promotions"],
      ["Billing", "/dashboard/billing"],
      ["Analytics", "/dashboard/analytics"],
      ["Team", "/dashboard/team"],
      ["Settings", "/dashboard/settings"],
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function DashboardNav() {
  const pathname = usePathname();
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(GROUPS.map((_, i) => String(i))));
  const [mobileOpen, setMobileOpen] = useState(false);

  function toggleGroup(index: number) {
    const key = String(index);
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  useEffect(() => {
    const onToggle = () => setMobileOpen((open) => !open);
    window.addEventListener("toggle-mobile-nav", onToggle);
    return () => window.removeEventListener("toggle-mobile-nav", onToggle);
  }, []);

  return (
    <>
      {/* Mobile drawer */}
      <div
        className={`fixed inset-0 z-40 lg:hidden transition-opacity duration-200 ${mobileOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        aria-hidden={!mobileOpen}
      >
        <div
          className="absolute inset-0 bg-black/50"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
        <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl transform transition-transform duration-200 ease-in-out lg:hidden" style={{ transform: mobileOpen ? "translateX(0)" : "translateX(-100%)" }}>
          <div className="flex items-center justify-between p-4 border-b border-ink-100">
            <span className="font-bold">Menu</span>
            <button onClick={() => setMobileOpen(false)} className="p-1 rounded hover:bg-ink-50" aria-label="Close menu">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <nav className="p-3 space-y-1 overflow-y-auto max-h-[calc(100vh-4rem)]" aria-label="Dashboard">
            {GROUPS.map((g, gi) => (
              <div key={gi} className="min-w-0">
                {g.title && (
                  <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-300">
                    {g.title}
                  </div>
                )}
                {g.items.map(([label, href]) => {
                  const active = isActive(pathname, href);
                  return (
                    <Link
                      key={href + label}
                      href={href}
                      onClick={() => setMobileOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={`block whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${
                        active ? "bg-ink-900 text-white" : "text-ink-700 hover:bg-ink-50"
                      }`}
                    >
                      {label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>
      </div>

      {/* Desktop sidebar */}
      <nav aria-label="Dashboard" className="hidden lg:block card h-fit p-2 md:sticky md:top-20">
        <div className="space-y-4">
          {GROUPS.map((g, gi) => (
            <div key={gi} className="min-w-[140px] flex-1 md:min-w-0 md:flex-none">
              {g.title && (
                <button
                  type="button"
                  onClick={() => toggleGroup(gi)}
                  className="flex w-full items-center justify-between px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-300 hover:text-ink-500"
                  aria-expanded={openGroups.has(String(gi))}
                >
                  {g.title}
                  <svg className={`w-4 h-4 shrink-0 transition-transform ${openGroups.has(String(gi)) ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>
              )}
              <div className={`${openGroups.has(String(gi)) ? "block" : "hidden"} md:block`}>
                {g.items.map(([label, href]) => {
                  const active = isActive(pathname, href);
                  return (
                    <Link
                      key={href + label}
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={`block whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${
                        active ? "bg-ink-900 text-white" : "text-ink-700 hover:bg-ink-50"
                      }`}
                    >
                      {label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>
    </>
  );
}
