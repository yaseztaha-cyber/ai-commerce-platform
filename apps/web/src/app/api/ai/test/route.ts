import { Errors, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";
import { runAgentTurn } from "@/server/ai/agent";
import { getOrCreateConversation, appendMessage } from "@/server/conversations";
import { findOrCreateCustomer } from "@/server/customers";
import { ensureInit } from "@/server/init";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { config } from "@/lib/env";
import { z } from "zod";

/** AI playground: owner/admin tests the agent and observes tools used. */
export async function POST(req: Request) {
  ensureInit();
  const requestId = newRequestId();
  // Expensive endpoint (LLM + tools): strict per-IP budget on top of ADMIN role.
  const rl = rateLimit(`ai:${clientKey(req)}`, 30, config.rateLimit.windowMs);
  if (!rl.allowed) return Errors.rateLimited(requestId);
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "ADMIN");
  } catch {
    return Errors.forbidden(requestId);
  }
  const body = await req.json().catch(() => null);
  const parsed = z.object({ message: z.string().min(1).max(2000), phone: z.string().default("01000000001") }).safeParse(body);
  if (!parsed.success) return Errors.validation(requestId);

  const customer = await findOrCreateCustomer(s.tenantId, parsed.data.phone, "Test Chat");
  const convo = await getOrCreateConversation({ tenantId: s.tenantId, channel: "SIMULATOR", externalId: `SIMULATOR:${parsed.data.phone}`, customerId: customer.id });
  await appendMessage({ tenantId: s.tenantId, conversationId: convo.id, role: "customer", content: parsed.data.message });
  const started = Date.now();
  const reply = await runAgentTurn({ tenantId: s.tenantId, conversationId: convo.id, customerId: customer.id, userText: parsed.data.message, requestId });
  if (reply.text) await appendMessage({ tenantId: s.tenantId, conversationId: convo.id, role: "assistant", content: reply.text, latencyMs: Date.now() - started });
  const convoFresh = await (await import("@ai-commerce/database")).prisma.conversation.findUnique({ where: { id: convo.id } });
  return ok({ reply: reply.text, image: reply.image ?? null, toolsUsed: reply.toolsUsed, escalated: reply.escalated ?? false, orderState: convoFresh?.orderState, conversationId: convo.id }, { requestId });
}
