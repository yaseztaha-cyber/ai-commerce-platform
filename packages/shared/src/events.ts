export const DOMAIN_EVENTS = [
  "customer.created",
  "message.received",
  "conversation.created",
  "order.created",
  "order.confirmed",
  "order.cancelled",
  "order.completed",
  "order.status_changed",
  "inventory.low",
  "inventory.changed",
  "human.requested",
  "document.indexed",
] as const;
export type DomainEvent = (typeof DOMAIN_EVENTS)[number];

export interface DomainEventEnvelope<T = unknown> {
  event: DomainEvent;
  tenantId: string;
  occurredAt: string;
  requestId?: string;
  payload: T;
}
