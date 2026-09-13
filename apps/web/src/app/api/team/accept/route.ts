import { Errors, fail, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { config } from "@/lib/env";
import { acceptInvite } from "@/server/team";
import { z } from "zod";

/** Public invite acceptance (rate-limited). Token alone determines the tenant. */
export async function POST(req: Request) {
  const requestId = newRequestId();
  const rl = rateLimit(`invite:${clientKey(req)}`, config.rateLimit.maxAuth, config.rateLimit.windowMs);
  if (!rl.allowed) return Errors.rateLimited(requestId);
  const body = await req.json().catch(() => null);
  const parsed = z
    .object({ token: z.string().min(10).max(200), name: z.string().max(120).optional(), password: z.string().min(8).max(128).optional() })
    .safeParse(body);
  if (!parsed.success) return Errors.validation(requestId, parsed.error.flatten());
  try {
    const r = await acceptInvite(parsed.data);
    return ok({ accepted: true, tenantId: r.tenantId, role: r.role }, { requestId, status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Accept failed";
    return fail("ACCEPT_FAILED", msg, { status: 400, requestId });
  }
}
