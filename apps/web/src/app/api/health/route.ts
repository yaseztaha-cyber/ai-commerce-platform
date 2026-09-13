import { NextResponse } from "next/server";
import { prisma } from "@ai-commerce/database";
import { ensureInit } from "@/server/init";

export const dynamic = "force-dynamic";

export async function GET() {
  ensureInit();
  let db = "down";
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "up";
  } catch {
    db = "down";
  }
  return NextResponse.json({ ok: true, data: { status: "ok", db, ts: new Date().toISOString() } });
}
