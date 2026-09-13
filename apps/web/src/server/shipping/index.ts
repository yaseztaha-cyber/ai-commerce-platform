import { ShippingProvider, ShipmentInput, isShippingConfigured, ShippingError } from "./types";
import { BostaProvider } from "./bosta";

let cachedProvider: ShippingProvider | null = null;

/** Get the configured shipping provider (singleton per process). */
export function getShippingProvider(): ShippingProvider | null {
  if (cachedProvider) return cachedProvider;
  if (!isShippingConfigured()) return null;

  // Currently only Bosta is implemented
  cachedProvider = new BostaProvider();
  return cachedProvider;
}

export { ShippingError };

/** Create a shipment for an order. */
export async function createShipment(input: ShipmentInput): Promise<{ trackingNumber: string; labelUrl: string; raw: unknown }> {
  const provider = getShippingProvider();
  if (!provider) throw new ShippingError("disabled", "No shipping provider configured");
  return provider.createShipment(input);
}

/** Track a shipment by tracking number. */
export async function trackShipment(trackingNumber: string) {
  const provider = getShippingProvider();
  if (!provider) throw new ShippingError("disabled", "No shipping provider configured");
  return provider.trackShipment(trackingNumber);
}

/** Cancel a shipment if supported. */
export async function cancelShipment(trackingNumber: string) {
  const provider = getShippingProvider();
  if (!provider || !provider.cancelShipment) throw new ShippingError("disabled", "Cancellation not supported");
  return provider.cancelShipment(trackingNumber);
}

/** Verify and parse a webhook payload. */
export function handleShippingWebhook(payload: string, signature: string) {
  const provider = getShippingProvider();
  if (!provider) throw new ShippingError("disabled", "No shipping provider configured");

  if (provider.verifyWebhook && !provider.verifyWebhook(payload, signature)) {
    throw new ShippingError("invalid_signature", "Webhook signature verification failed");
  }

  const parsed = JSON.parse(payload);
  if (provider.parseWebhook) {
    return provider.parseWebhook(parsed);
  }
  return null;
}

/** Map courier status to our order status. */
export function mapCourierStatusToOrderStatus(courierStatus: string): string | null {
  const map: Record<string, string> = {
    created: "READY",
    picked_up: "OUT_FOR_DELIVERY",
    out_for_delivery: "OUT_FOR_DELIVERY",
    delivered: "COMPLETED",
    returned: "RETURNED",
    failed_delivery: "FAILED",
    cancelled: "CANCELLED",
  };
  return map[courierStatus] ?? null;
}