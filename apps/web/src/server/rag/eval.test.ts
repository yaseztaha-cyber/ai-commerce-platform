import { describe, expect, it, beforeAll } from "vitest";
import { prisma } from "@ai-commerce/database";
import { retrieveKnowledge } from "./retrieve";

/**
 * Retrieval quality gate (seed tenant must be seeded).
 * Each question must retrieve its expected source top-1.
 * Pure transactional questions (stock/price) must NOT be answered from RAG —
 * that routing is covered by agent-level tests; here we assert RAG precision.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

const CASES: Array<{ question: string; expectTitle: string }> = [
  { question: "ما هي سياسة الاستبدال؟", expectTitle: "Exchange" },
  { question: "استرجاع خلال قد ايه والتيكت موجود؟", expectTitle: "Return" },
  { question: "الشحن للقاهرة بكام؟", expectTitle: "Shipping" },
  { question: "التوصيل بياخد قد ايه؟", expectTitle: "FAQ" },
  { question: "دليل المقاسات للاوفرسايز؟", expectTitle: "Size" },
  { question: "طرق الدفع المتاحة ايه؟", expectTitle: "FAQ" },
];

describe.skipIf(!hasDb)("rag retrieval eval", () => {
  let tenantId = "";

  beforeAll(async () => {
    const tenant = await prisma.tenant.findUnique({ where: { slug: "yasez-fashion" } });
    if (!tenant) throw new Error("seed missing: run db:seed first");
    tenantId = tenant.id;
  });

  for (const c of CASES) {
    it(`retrieves '${c.expectTitle}' for: ${c.question.slice(0, 40)}`, async () => {
      const hits = await retrieveKnowledge(tenantId, c.question, 3);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].title).toContain(c.expectTitle);
    });
  }

  it("covers both sources for a genuinely mixed fee+duration question", async () => {
    // Ambiguous by design: fee lives in Shipping, duration also in FAQ.
    // Production consumes top-4, so the contract is coverage, not top-1.
    const hits = await retrieveKnowledge(tenantId, "الشحن للقاهرة بكام وبياخد قد ايه؟", 4);
    const titles = hits.map((h) => h.title).join(" ");
    expect(titles).toContain("Shipping");
    expect(titles).toContain("FAQ");
  });

  it("never leaks another tenant's chunks", async () => {
    const other = await prisma.tenant.findFirst({ where: { NOT: { id: tenantId } }, select: { id: true } });
    if (!other) return; // no second tenant in this DB — isolation covered in security suite
    const hits = await retrieveKnowledge(other.id, "Exchange policy size guide shipping FAQ return", 5);
    for (const h of hits) {
      const chunk = await prisma.documentChunk.findFirst({ where: { id: h.documentId }, select: { tenantId: true } }).catch(() => null);
      void chunk;
    }
    // All hits must belong to the requesting tenant (enforced in query).
    const docs = await prisma.document.findMany({ where: { id: { in: hits.map((h) => h.documentId) } }, select: { tenantId: true } });
    expect(docs.every((d) => d.tenantId === other.id)).toBe(true);
  });
});
