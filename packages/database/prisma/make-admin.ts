/**
 * One-shot platform-admin bootstrap for production.
 *
 * `db:seed` is forbidden in production and `/api/auth/register` always
 * creates non-admin users, so the very first platform admin needs this:
 *
 *   1. Register normally at /register (creates user + tenant).
 *   2. Run: npm run db:make-admin --workspace=packages/database -- you@company.com
 *      (DATABASE_URL must point at the target database.)
 *
 * The script only ever *adds* the flag to one existing user — it never
 * creates users, touches tenants, or lists anything.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = (process.argv[2] ?? "").toLowerCase().trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("usage: npm run db:make-admin --workspace=packages/database -- you@company.com");
    process.exit(1);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`no user with email ${email} — register at /register first, then rerun.`);
    process.exit(1);
  }
  if (user.isPlatformAdmin) {
    console.log(`already a platform admin: ${email}`);
    return;
  }
  await prisma.user.update({ where: { id: user.id }, data: { isPlatformAdmin: true } });
  console.log(`platform admin granted: ${email}`);
}

main()
  .catch((err) => {
    console.error(`make-admin failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
