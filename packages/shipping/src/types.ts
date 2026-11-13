/** Normalised shipment states. Provider-specific wording is kept alongside as `providerStatus`. */
export type ShipmentState = 'created' | 'awb_assigned' | 'pickup_scheduled' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'returned' | 'cancelled' | 'exception';

export interface ShipAddress {
  name: string; line1: string; line2?: string | undefined; city: string; state: string; postalCode: string; country: string; phone: string; email: string;
}

export interface Parcel { weightGrams: number; lengthCm: number; breadthCm: number; heightCm: number }

export interface CourierQuote { courierId: string; name: string; rateMinor: number; etaDays: number | null }

export interface ShipmentRequest {
  /** Our order reference, shown in the provider's dashboard. */
  reference: string;
  orderDate: Date;
  /** Name of a pickup address saved in the merchant's provider account. */
  pickupLocation: string;
  to: ShipAddress;
  items: { name: string; sku: string; quantity: number; unitPriceMinor: number }[];
  subtotalMinor: number;
  parcel: Parcel;
}

export interface TrackingEvent { at: string; text: string; location: string | null }
export interface Tracking { state: ShipmentState; providerStatus: string; trackingUrl: string | null; estimatedDelivery: string | null; events: TrackingEvent[] }

export class ShippingError extends Error {
  constructor(message: string, readonly kind: 'auth' | 'invalid' | 'unavailable' | 'provider', readonly status?: number) {
    super(message);
  }
}

/**
 * A delivery partner. Each step is a separate call so a failure half-way (for example, no wallet balance when
 * assigning a courier) leaves a shipment that can be resumed rather than duplicated.
 */
export interface ShippingProvider {
  readonly name: string;
  testConnection(): Promise<{ ok: true } | { ok: false; error: string }>;
  quote(q: { pickupPostcode: string; deliveryPostcode: string; weightGrams: number; declaredValueMinor: number }): Promise<CourierQuote[]>;
  createShipment(req: ShipmentRequest): Promise<{ providerOrderId: string; providerShipmentId: string }>;
  assignCourier(providerShipmentId: string, courierId?: string): Promise<{ awb: string; courierName: string }>;
  requestPickup(providerShipmentId: string): Promise<{ scheduledFor: string | null }>;
  label(providerShipmentId: string): Promise<{ url: string }>;
  track(awb: string): Promise<Tracking>;
  cancel(providerOrderId: string): Promise<void>;
}

export interface ShiprocketCredentials { provider: 'shiprocket'; email: string; password: string }
export type ShippingCredentials = ShiprocketCredentials;
export type ShippingFactory = (creds: ShippingCredentials) => ShippingProvider;
