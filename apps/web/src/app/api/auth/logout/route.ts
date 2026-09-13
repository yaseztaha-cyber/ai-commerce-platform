import { ok } from "@/lib/api";
import { clearSessionCookieHeader } from "@/server/auth";

export async function POST() {
  const res = ok({ loggedOut: true });
  res.headers.set("Set-Cookie", clearSessionCookieHeader());
  return res;
}
