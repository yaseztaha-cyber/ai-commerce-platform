-- Backfill: per-tenant order counters must start above existing order numbers.
UPDATE "Tenant" t
SET "orderSeq" = GREATEST(t."orderSeq", COALESCE(sub.maxn, t."orderSeq"))
FROM (SELECT "tenantId", MAX(number) AS maxn FROM "Order" GROUP BY "tenantId") sub
WHERE t.id = sub."tenantId";
