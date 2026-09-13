# Data privacy & erasure

## Customer erasure — `DELETE /api/customers/[id]` (MANAGER+)

What happens, in one transaction:

1. Addresses deleted.
2. Orders **detached** (`customerId → null`) but preserved with their price
   snapshots — finance/audit integrity requires order history to survive.
3. Conversations detached, messages preserved (support history).
4. PII anonymized: name → `Deleted customer`, phone → `deleted-<id>`,
   email/notes/tags/consent cleared.

An `audit.customer.erased` record is written **and retained by design**:
erasure removes personal data, not the fact that an erasure occurred
(required for abuse investigation and regulatory proof).

## Conversation deletion — `DELETE /api/conversations/[id]` (MANAGER+)

Deletes messages, tool calls, and AI runs for that thread; detaches linked
orders (orders themselves are preserved). Use for "delete my chat history"
requests after resolving any open order.

## Knowledge deletion — `DELETE /api/knowledge/[id]` (MANAGER+)

Deletes the document **and all chunks/embeddings** (FK cascade), so nothing
is retrievable afterwards. Re-index first if only the content changed
(`PUT` bumps `version` instead).

## Tenant deletion

No self-service API (too destructive). Operator procedure — order matters,
because order lines reference variants with `Restrict` (order history is
protected from cascade accidents):

```sql
-- 1. purge order lines + history first (tenant id from slug)
DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "tenantId" = '<tenant-id>');
DELETE FROM "OrderStatusHistory" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "tenantId" = '<tenant-id>');
DELETE FROM "Order" WHERE "tenantId" = '<tenant-id>';
-- 2. then the tenant (cascades to memberships, customers, products,
-- conversations, documents, notifications, audit logs, subscriptions, usage)
DELETE FROM "Tenant" WHERE id = '<tenant-id>';
```

Product images in object storage must be removed by prefix separately.

## Size & body data (leak 6)

- Body metrics (height/weight/chest) live **only in the conversation
  transcript** — they are never written to the customer profile or any
  table, and never enter analytics.
- `preferredSize` (e.g. "L") is stored **only** on explicit opt-in
  ("my size is always L") or after 2+ consistent confirmed orders. It is
  used solely to suggest ("same as last time?"), never to decide alone.
- Erasure (`DELETE /api/customers/[id]`) clears `preferredSize` alongside
  all other PII.

## Phone verification data (leak 7)

- SMS codes exist only as SHA-256 hashes, bound to one order, expiring in
  10 minutes. Raw codes are never stored, never logged, never returned by
  any API (the playground shows the agent's reply, not the code).
- Wrong guesses increment a counter; rows lock at 5 attempts. Expired and
  locked rows are inert. Erasure deletes the customer's rows with everything
  else; detached orders keep no verification data.

## Export

Customer profile + order list: `GET /api/customers?q=<phone>` plus
`GET /api/orders` filtered by that customer (dashboard flow). Full
machine-readable export is a support operation, not a customer button.

## What is NOT deleted

- `AuditLog` rows (who did what, when) — retained.
- `InventoryMovement` rows — stock ledger integrity.
- `OrderStatusHistory` rows — order lifecycle proof.
- Anonymized aggregates (analytics counts).
