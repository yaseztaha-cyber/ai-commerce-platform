export const ORDER_STATUSES = [
  "DRAFT",
  "PENDING_CONFIRMATION",
  "CONFIRMED",
  "PROCESSING",
  "READY",
  "OUT_FOR_DELIVERY",
  "COMPLETED",
  "CANCELLED",
  "FAILED",
  "RETURNED",
  "REFUNDED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const TERMINAL_ORDER_STATUSES: OrderStatus[] = [
  "COMPLETED",
  "CANCELLED",
  "FAILED",
  "RETURNED",
  "REFUNDED",
];

/** Allowed transitions. Enforced by backend; LLM can never bypass. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ["PENDING_CONFIRMATION", "CANCELLED", "FAILED"],
  PENDING_CONFIRMATION: ["CONFIRMED", "CANCELLED", "FAILED", "DRAFT"],
  CONFIRMED: ["PROCESSING", "CANCELLED", "FAILED"],
  PROCESSING: ["READY", "CANCELLED", "FAILED"],
  READY: ["OUT_FOR_DELIVERY", "CANCELLED", "FAILED"],
  OUT_FOR_DELIVERY: ["COMPLETED", "FAILED", "RETURNED"],
  COMPLETED: ["RETURNED", "REFUNDED"],
  CANCELLED: [],
  FAILED: ["DRAFT"],
  RETURNED: ["REFUNDED"],
  REFUNDED: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export const CONVERSATION_STATUSES = [
  "AI_ACTIVE",
  "HUMAN_REQUIRED",
  "HUMAN_ACTIVE",
  "RESOLVED",
  "SPAM",
] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const CONVERSATION_ORDER_STATES = [
  "DISCOVERY",
  "PRODUCT_IDENTIFIED",
  "VARIANT_SELECTION",
  "QUANTITY_SELECTION",
  "CUSTOMER_INFORMATION",
  "DELIVERY_SELECTION",
  "PAYMENT_SELECTION",
  "ORDER_REVIEW",
  "CUSTOMER_CONFIRMATION",
  "ORDER_CREATED",
] as const;
export type ConversationOrderState = (typeof CONVERSATION_ORDER_STATES)[number];

export const ROLES = ["OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_RANK: Record<Role, number> = {
  VIEWER: 1,
  AGENT: 2,
  MANAGER: 3,
  ADMIN: 4,
  OWNER: 5,
};

export function roleAtLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export const CHANNELS = [
  "WHATSAPP",
  "INSTAGRAM",
  "MESSENGER",
  "WEBSITE",
  "TELEGRAM",
  "SIMULATOR",
] as const;
export type Channel = (typeof CHANNELS)[number];

export const PAYMENT_METHODS = [
  "CASH_ON_DELIVERY",
  "BANK_TRANSFER",
  "PAYMENT_LINK",
  "MANUAL",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const INVENTORY_MOVEMENT_TYPES = [
  "SALE",
  "RESTOCK",
  "ADJUSTMENT",
  "RETURN",
  "CORRECTION",
] as const;
export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];

export const DOCUMENT_STATUSES = [
  "UPLOADED",
  "PROCESSING",
  "READY",
  "FAILED",
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const MAX_TOOL_CALLS_DEFAULT = 8;

export const CONFIRMATION_WORDS = new Set([
  // Arabic (Egyptian + MSA)
  "اكد", "أكد", "اكّد", "تمام", "ماشي", "اوك", "أوك", "موافق", "ايوه", "أيوه",
  "اه", "آه", "نعم", "ايوة", "تمام اكد", "اكد الاوردر", "أكد الأوردر",
  // English
  "yes", "yeah", "yep", "confirm", "confirmed", "ok", "okay", "place order", "checkout",
]);

export const CANCEL_WORDS = new Set([
  "الغي", "ألغي", "الغاء", "إلغاء", "بلاش", "مش عايز", "cancel",
]);

export const HUMAN_REQUEST_PATTERNS: RegExp[] = [
  /عايز اكلم حد|عايز أكلم حد|كلميني حد|وصلني بحد|ممكن اكلم انسان|عاوز بشر|human|agent please|talk to (someone|human|agent|support)/i,
  /عايز.*(موظف|مندوب|خدمة العملاء|حد يكلمني)/i,
  /(connect|transfer).{0,20}(human|agent)/i,
];
