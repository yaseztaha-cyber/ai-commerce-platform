import * as env from "../../lib/env";
import { logger } from "../../lib/logger";
import crypto from "crypto";
import {
  ShippingProvider,
  ShipmentInput,
  ShipmentResult,
  TrackingEvent,
  TrackingResult,
  BOSTA_TO_ORDER_STATUS,
  ShippingError,
} from "./types";

const BOSTA_BASE = "https://api.bosta.co";
const BOSTA_SANDBOX_BASE = "https://api-sandbox.bosta.co";

interface BostaAddress {
  first_name: string;
  last_name: string;
  phone: string;
  email?: string;
  address_line_1: string;
  address_line_2?: string;
  city: string;
  state: string;
  postal_code?: string;
  country: "EG";
}

interface BostaCreateShipmentPayload {
  delivery_type: "pickup" | "dropoff";
  cod: number;
  weight: number;
  dimensions: { length: number; width: number; height: number };
  items: Array<{ name: string; quantity: number; price: number }>;
  notes?: string;
  reference: string;
  pickup_address: BostaAddress;
  dropoff_address: BostaAddress;
}

interface BostaShipmentResponse {
  id: string;
  tracking_number: string;
  label_url: string;
  status: string;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

interface BostaTrackingResponse {
  id: string;
  tracking_number: string;
  status: string;
  status_history: Array<{
    status: string;
    description?: string;
    created_at: string;
    location?: string;
  }>;
  label_url: string;
  [key: string]: unknown;
}

interface BostaWebhookPayload {
  event: "shipment.created" | "shipment.picked_up" | "shipment.out_for_delivery" | "shipment.delivered" | "shipment.returned" | "shipment.failed_delivery" | "shipment.cancelled";
  shipment: BostaTrackingResponse;
}

/** Normalize phone to E.164 for Egypt. */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("20")) return `+${digits}`;
  if (digits.startsWith("0")) return `+2${digits}`;
  if (digits.length === 10) return `+20${digits}`;
  return `+${digits}`;
}

/** Split name into first/last for Bosta. */
function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  return { first: parts[0] ?? "Customer", last: parts.slice(1).join(" ") || "Customer" };
}

export class BostaProvider implements ShippingProvider {
  readonly name = "bosta";
  readonly supportsTracking = true;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly webhookSecret: string;
  private readonly pickupAddress: BostaAddress;

  constructor(opts?: { apiKey?: string; sandbox?: boolean; webhookSecret?: string; pickupAddress?: BostaAddress }) {
    this.apiKey = opts?.apiKey ?? env.config.shipping.bostaApiKey;
    this.webhookSecret = opts?.webhookSecret ?? env.config.shipping.bostaWebhookSecret;
    const sandbox = opts?.sandbox ?? env.config.shipping.bostaSandbox ?? true;
    this.baseUrl = sandbox ? BOSTA_SANDBOX_BASE : BOSTA_BASE;

    // Default pickup address from env (merchant warehouse)
    this.pickupAddress = opts?.pickupAddress ?? {
      first_name: env.config.shipping.pickupFirstName ?? "Store",
      last_name: env.config.shipping.pickupLastName ?? "Pickup",
      phone: env.config.shipping.pickupPhone ?? "+201000000000",
      email: env.config.shipping.pickupEmail,
      address_line_1: env.config.shipping.pickupAddressLine1 ?? "123 Warehouse St",
      city: env.config.shipping.pickupCity ?? "Cairo",
      state: env.config.shipping.pickupState ?? "Cairo",
      postal_code: env.config.shipping.pickupPostalCode,
      country: "EG",
    };
  }

  private async request<T>(path: string, opts: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...opts,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          ...(opts.headers || {}),
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        logger.error("Bosta request failed", { path, status: res.status, body: text.slice(0, 500) });
        throw new ShippingError("failed", `Bosta ${res.status}: ${text}`);
      }
      return res.json() as Promise<T>;
    } catch (err) {
      if (err instanceof ShippingError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new ShippingError("timeout", "Bosta request timeout");
      }
      logger.error("Bosta request error", { path, error: String(err) });
      throw new ShippingError("unavailable", `Bosta request failed: ${err}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async createShipment(input: ShipmentInput): Promise<ShipmentResult> {
    const { first, last } = splitName(input.name);
    const dropoff: BostaAddress = {
      first_name: first,
      last_name: last,
      phone: normalizePhone(input.phone),
      address_line_1: input.address,
      city: input.city,
      state: input.city,
      country: "EG",
    };

    const payload: BostaCreateShipmentPayload = {
      delivery_type: "pickup",
      cod: input.codAmount,
      weight: input.weightGrams ?? 500,
      dimensions: input.dimensions ?? { length: 20, width: 15, height: 5 },
      items: [{ name: `Order #${input.orderNumber}`, quantity: 1, price: input.codAmount }],
      notes: input.notes,
      reference: `ORD-${input.orderNumber}`,
      pickup_address: this.pickupAddress,
      dropoff_address: dropoff,
    };

    const res = await this.request<BostaShipmentResponse>("/v2/shipments", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    return {
      trackingNumber: res.tracking_number,
      labelUrl: res.label_url,
      raw: res,
    };
  }

  async trackShipment(trackingNumber: string): Promise<TrackingResult> {
    const res = await this.request<BostaTrackingResponse>(`/v2/shipments/track/${trackingNumber}`);

    const events: TrackingEvent[] = (res.status_history ?? []).map((h) => ({
      trackingNumber: res.tracking_number,
      status: h.status,
      description: h.description,
      occurredAt: h.created_at ? new Date(h.created_at) : undefined,
      raw: h,
    }));

    return {
      status: res.status,
      events: events.reverse(), // newest first
      raw: res,
    };
  }

  async cancelShipment(trackingNumber: string): Promise<{ success: boolean; raw: unknown }> {
    try {
      const res = await this.request<{ success: boolean }>(`/v2/shipments/${trackingNumber}/cancel`, {
        method: "POST",
      });
      return { success: res.success ?? true, raw: res };
    } catch (err) {
      logger.warn("Bosta cancel failed", { trackingNumber, error: String(err) });
      return { success: false, raw: err };
    }
  }

  verifyWebhook(payload: string, signature: string): boolean {
    if (!this.webhookSecret) {
      logger.warn("Bosta webhook secret not configured — rejecting webhook (fail closed)");
      return false;
    }
    const expected = crypto.createHmac("sha256", this.webhookSecret).update(payload).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  parseWebhook(payload: unknown): TrackingEvent | null {
    const p = payload as BostaWebhookPayload;
    if (!p?.shipment?.tracking_number || !p?.event) return null;

    const shipment = p.shipment;
    const status = p.event.replace("shipment.", "");
    return {
      trackingNumber: shipment.tracking_number,
      status,
      description: BOSTA_TO_ORDER_STATUS[status] ? `Order will move to ${BOSTA_TO_ORDER_STATUS[status]}` : undefined,
      occurredAt: new Date(),
      raw: p,
    };
  }
}