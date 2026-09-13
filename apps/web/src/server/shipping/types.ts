/**
 * Courier integration (leak 3). `ShippingProvider` is a tiny interface so
 * the vendor stays env-configured. Starting with Bosta (Egyptian SMB standard).
 * Sandbox mode by default so dev never books real pickups.
 */

import { config } from "@/lib/env";

export type _ShippingErrorKind =
  | "disabled"
  | "unavailable"
  | "bad_address"
  | "bad_phone"
  | "timeout"
  | "failed"
  | "invalid_signature"
  | "unknown_event";

export class ShippingError extends Error {
  readonly kind: _ShippingErrorKind;
  constructor(kind: _ShippingErrorKind, message: string) {
    super(message);
    this.name = "ShippingError";
    this.kind = kind;
  }
}

export interface ShipmentInput {
  /** Order number (tenant-scoped) for idempotency / reference. */
  orderNumber: number;
  /** Recipient full name. */
  name: string;
  /** Phone in E.164 or local (010xxxxxxxx). */
  phone: string;
  /** Full address line. */
  address: string;
  /** City/area for courier routing. */
  city: string;
  /** Optional notes for courier. */
  notes?: string;
  /** Cash-on-delivery amount in minor units (piastres/EGP*100). */
  codAmount: number;
  /** Package dimensions (cm) for volumetric weight. */
  dimensions?: { length: number; width: number; height: number };
  /** Weight in grams. */
  weightGrams?: number;
}

export interface ShipmentResult {
  /** Provider's tracking number. */
  trackingNumber: string;
  /** Label PDF / print URL. */
  labelUrl: string;
  /** Raw provider response for audit. */
  raw: unknown;
}

export interface TrackingEvent {
  /** Provider's tracking number. */
  trackingNumber: string;
  /** Courier status code (e.g., Bosta: "picked_up", "out_for_delivery", "delivered", "returned"). */
  status: string;
  /** Human-readable description. */
  description?: string;
  /** When the event happened (courier time). */
  occurredAt?: Date;
  /** Raw webhook payload for audit. */
  raw: unknown;
}

export interface TrackingResult {
  /** Current courier status. */
  status: string;
  /** History of events (newest first). */
  events: TrackingEvent[];
  /** Raw provider response. */
  raw: unknown;
}

export interface ShippingProvider {
  readonly name: string;
  readonly supportsTracking: boolean;
  /** Create a shipment and return tracking number + label. */
  createShipment(input: ShipmentInput): Promise<ShipmentResult>;
  /** Fetch current tracking state. */
  trackShipment(trackingNumber: string): Promise<TrackingResult>;
  /** Cancel a shipment (if supported by courier). */
  cancelShipment?(trackingNumber: string): Promise<{ success: boolean; raw: unknown }>;
  /** Verify webhook signature (HMAC per provider). */
  verifyWebhook?(payload: string, signature: string): boolean;
  /** Parse webhook payload into normalized TrackingEvent. */
  parseWebhook?(payload: unknown): TrackingEvent | null;
}

/** Check if any shipping provider is configured. */
export function isShippingConfigured(): boolean {
  return Boolean(config.shipping.bostaApiKey);
}

/** Bosta status → our order status map. */
export const BOSTA_TO_ORDER_STATUS: Record<string, string> = {
  created: "READY",
  picked_up: "OUT_FOR_DELIVERY",
  out_for_delivery: "OUT_FOR_DELIVERY",
  delivered: "COMPLETED",
  returned: "RETURNED",
  failed_delivery: "FAILED",
  cancelled: "CANCELLED",
};

/** Our order status → Bosta action (for cancel). */
export const ORDER_STATUS_TO_BOSTA_ACTION: Record<string, string> = {
  READY: "cancel",
  OUT_FOR_DELIVERY: "return",
};