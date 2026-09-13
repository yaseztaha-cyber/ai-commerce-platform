import { z } from "zod";

export const uuid = z.string().min(1, "id required");
export const tenantScoped = z.object({ tenantId: uuid });

export const moneySchema = z.number().int().min(0);

export const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  nameAr: z.string().max(200).optional(),
  description: z.string().max(5000).optional(),
  descriptionAr: z.string().max(5000).optional(),
  brand: z.string().max(120).optional(),
  categoryId: z.string().optional().nullable(),
  basePrice: moneySchema,
  currency: z.string().default("EGP"),
  aliases: z.array(z.string()).default([]),
  active: z.boolean().default(true),
  /**
   * Quick-add stock: creates a default "One Size" variant with this quantity.
   * Applied as a traced movement, never silently.
   */
  quantity: z.number().int().min(0).max(1000000).optional(),
});

export const upsertVariantSchema = z.object({
  productId: uuid,
  sku: z.string().min(1).max(80),
  price: moneySchema.optional().nullable(),
  attributes: z.record(z.string().min(1).max(60), z.string().min(1).max(120)),
  active: z.boolean().default(true),
  /** Initial/current stock. Applied as a traced movement, never silently. */
  quantity: z.number().int().min(0).max(1000000).optional(),
});

export const adjustInventorySchema = z.object({
  variantId: uuid,
  delta: z.number().int().min(-100000).max(100000).refine((v) => v !== 0, "delta cannot be 0"),
  type: z.enum(["RESTOCK", "ADJUSTMENT", "CORRECTION", "RETURN"]),
  reason: z.string().max(500).optional(),
});

export const createOrderDraftSchema = z.object({
  conversationId: uuid,
  customerId: uuid.optional(),
  customerName: z.string().max(200).optional(),
  customerPhone: z.string().max(40).optional(),
  address: z.string().max(1000).optional(),
  deliveryZoneId: z.string().optional().nullable(),
  paymentMethod: z.enum(["CASH_ON_DELIVERY", "BANK_TRANSFER", "PAYMENT_LINK", "MANUAL"]).default("CASH_ON_DELIVERY"),
  idempotencyKey: z.string().min(4).max(120),
  lines: z
    .array(
      z.object({
        variantId: uuid,
        quantity: z.number().int().min(1).max(99),
      })
    )
    .min(1)
    .max(20),
});

export const updateOrderDraftSchema = z.object({
  orderId: uuid,
  action: z.enum(["add", "remove", "set_quantity", "set_variant", "clear", "set_address", "set_zone", "set_payment"]),
  variantId: z.string().optional(),
  quantity: z.number().int().min(1).max(99).optional(),
  address: z.string().max(1000).optional(),
  deliveryZoneId: z.string().nullable().optional(),
  paymentMethod: z.enum(["CASH_ON_DELIVERY", "BANK_TRANSFER", "PAYMENT_LINK", "MANUAL"]).optional(),
});

export const confirmOrderSchema = z.object({
  orderId: uuid,
  idempotencyKey: z.string().min(4).max(120),
});

export const webhookIngestSchema = z.object({
  provider: z.enum(["WHATSAPP", "WEBSITE", "TELEGRAM", "SIMULATOR"]),
  providerMessageId: z.string().min(1).max(200),
  tenantId: z.string().min(1),
  channel: z.string().min(1),
  from: z.string().min(1).max(80),
  text: z.string().max(8000).default(""),
  timestamp: z.string().optional(),
});

export const knowledgeUpsertSchema = z.object({
  title: z.string().min(1).max(300),
  type: z.enum(["FAQ", "POLICY", "GUIDE", "PROMOTION", "DESCRIPTION", "TEXT"]).default("TEXT"),
  language: z.string().default("ar"),
  content: z.string().min(1).max(100000),
  productId: z.string().optional().nullable(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
