import { prisma } from "@ai-commerce/database";
import { roleAtLeast, type Role } from "@ai-commerce/shared";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { config } from "@/lib/env";

const secret = new TextEncoder().encode(config.jwtSecret);

export interface Session {
  userId: string;
  email: string;
  tenantId: string;
  role: Role;
  isPlatformAdmin: boolean;
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 12);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ ...s })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${config.sessionTtlHours}h`)
    .sign(secret);
}

export async function readSessionToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    const s = payload as unknown as Session;
    if (!s.userId || !s.tenantId) return null;
    return s;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const token = cookies().get(config.sessionCookie)?.value;
  if (!token) return null;
  return readSessionToken(token);
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw Object.assign(new Error("UNAUTHORIZED"), { status: 401 });
  return s;
}

/** Verify membership fresh from DB (role may have changed). */
export async function requireRole(tenantId: string, minimum: Role): Promise<Session> {
  const s = await requireSession();
  if (s.isPlatformAdmin) return s;
  if (s.tenantId !== tenantId) throw Object.assign(new Error("FORBIDDEN"), { status: 403 });
  const m = await prisma.membership.findUnique({
    where: { tenantId_userId: { tenantId, userId: s.userId } },
  });
  if (!m || !roleAtLeast(m.role as Role, minimum)) {
    throw Object.assign(new Error("FORBIDDEN"), { status: 403 });
  }
  return { ...s, role: m.role as Role };
}

export function sessionCookieHeader(token: string): string {
  const maxAge = config.sessionTtlHours * 3600;
  const secure = config.appUrl.startsWith("https://") ? "Secure;" : "";
  return `${config.sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}; ${secure}`;
}

export function clearSessionCookieHeader(): string {
  return `${config.sessionCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0;`;
}
