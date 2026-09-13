import Link from "next/link";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@ai-commerce/database";
import { readSessionToken } from "@/server/auth";
import DashboardNav from "@/components/DashboardNav";
import MobileMenuButton from "@/components/MobileMenuButton";
import { ToastProvider } from "@/components/Toast";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const raw = cookies().get(process.env.SESSION_COOKIE_NAME ?? "ac_session")?.value;
  if (!raw) redirect("/login");
  const session = await readSessionToken(raw);
  if (!session) redirect("/login");
  const [tenant, user] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: session.tenantId }, select: { name: true, slug: true } }),
    prisma.user.findUnique({ where: { id: session.userId }, select: { email: true, name: true } }),
  ]);
  if (!tenant) redirect("/login");

  return (
    <ToastProvider>
      <div className="min-h-screen bg-ink-50/50">
        <header className="sticky top-0 z-10 border-b border-ink-100 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <div className="flex items-center gap-3">
              <MobileMenuButton />
              <Link href="/dashboard" className="flex min-w-0 items-center gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ink-900 text-sm font-bold text-white">Y</div>
                <span className="truncate font-bold tracking-tight">
                  {tenant.name}
                  <span className="ml-2 hidden text-xs font-medium text-ink-300 sm:inline">YASEZ Commerce</span>
                </span>
              </Link>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="hidden max-w-[220px] truncate text-xs text-ink-500 md:inline" title={user?.email ?? ""}>
                {user?.name ?? user?.email} · {session.role}
              </span>
              <form action="/api/auth/logout" method="post">
                <button className="rounded-md px-2 py-1 text-sm text-ink-500 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600">
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </header>
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 md:grid-cols-[210px_1fr]">
          <DashboardNav />
          <main className="min-w-0">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
