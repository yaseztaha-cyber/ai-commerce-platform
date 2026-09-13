import fs from "fs";
import { NextResponse } from "next/server";
import { newRequestId } from "@/lib/logger";
import { resolveStoredFile } from "@/server/storage";

export const dynamic = "force-dynamic";

/** Public file serving (unguessable URLs). No secrets or listings here. */
export async function GET(_req: Request, { params }: { params: { path: string[] } }) {
  const requestId = newRequestId();
  const [tenantId, filename] = params.path ?? [];
  const resolved = tenantId && filename ? resolveStoredFile(tenantId, filename) : null;
  if (!resolved) return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "Not found" }, requestId }, { status: 404 });
  try {
    const data = await fs.promises.readFile(resolved.abs);
    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": resolved.mime,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": String(data.length),
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "Not found" }, requestId }, { status: 404 });
  }
}
