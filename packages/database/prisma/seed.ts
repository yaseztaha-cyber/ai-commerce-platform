/**
 * Seed: realistic demo clothing tenant "YASEZ Fashion".
 * Run: npm run db:seed --workspace=packages/database
 * Idempotent-ish: upserts by slug/email/sku.
 *
 * DEMO DATA — never run against production. Refuses when NODE_ENV=production
 * unless ALLOW_DEMO_SEED=true is explicitly set.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const COLORS = ["Black", "White", "Beige"] as const;
const SIZES = ["S", "M", "L", "XL"] as const;

const STOCK: Record<string, Record<string, number>> = {
  "Oversized T-Shirt": { "Black/S": 2, "Black/M": 5, "Black/L": 3, "Black/XL": 0, "White/S": 4, "White/M": 1, "White/L": 0, "White/XL": 2, "Beige/S": 0, "Beige/M": 3, "Beige/L": 2, "Beige/XL": 1 },
  "Classic T-Shirt": { "Black/S": 6, "Black/M": 8, "Black/L": 4, "Black/XL": 2, "White/S": 5, "White/M": 7, "White/L": 6, "White/XL": 3, "Beige/S": 2, "Beige/M": 2, "Beige/L": 1, "Beige/XL": 0 },
  Hoodie: { "Black/S": 3, "Black/M": 4, "Black/L": 5, "Black/XL": 2, "White/S": 1, "White/M": 2, "White/L": 1, "White/XL": 0, "Beige/S": 2, "Beige/M": 2, "Beige/L": 3, "Beige/XL": 1 },
  "Cargo Pants": { "Black/S": 2, "Black/M": 3, "Black/L": 2, "Black/XL": 1, "White/S": 0, "White/M": 1, "White/L": 1, "White/XL": 0, "Beige/S": 3, "Beige/M": 4, "Beige/L": 2, "Beige/XL": 2 },
  Jeans: { "Black/S": 1, "Black/M": 2, "Black/L": 2, "Black/XL": 1, "White/S": 0, "White/M": 0, "White/L": 1, "White/XL": 0, "Beige/S": 1, "Beige/M": 1, "Beige/L": 1, "Beige/XL": 1 },
  Sweatshirt: { "Black/S": 4, "Black/M": 4, "Black/L": 3, "Black/XL": 1, "White/S": 2, "White/M": 3, "White/L": 2, "White/XL": 1, "Beige/S": 1, "Beige/M": 2, "Beige/L": 2, "Beige/XL": 0 },
};

const PRODUCTS = [
  { name: "Oversized T-Shirt", nameAr: "تيشيرت أوفرسايز", price: 450, aliases: ["تيشيرت", "تيشرت", "tshirt", "tee", "oversized tee", "اوفرسايز"], desc: "Heavyweight oversized cotton T-shirt.", descAr: "تيشيرت أوفرسايز قطن تقيل." },
  { name: "Classic T-Shirt", nameAr: "تيشيرت كلاسيك", price: 350, aliases: ["تيشيرت كلاسيك", "classic tee", "tshirt"], desc: "Regular-fit everyday T-shirt.", descAr: "تيشيرت كلاسيك بقصّة مريحة." },
  { name: "Hoodie", nameAr: "هودي", price: 750, aliases: ["هودي", "hoodie", "سويت شيرت بغطا"], desc: "Fleece hoodie.", descAr: "هودي شتوي مبطن." },
  { name: "Cargo Pants", nameAr: "بنطلون كارجو", price: 650, aliases: ["كارجو", "cargo", "بنطلون"], desc: "Loose cargo pants with pockets.", descAr: "بنطلون كارجو واسع بجيوب." },
  { name: "Jeans", nameAr: "جينز", price: 800, aliases: ["جينز", "jeans", "بنطلون جينز"], desc: "Straight-fit denim jeans.", descAr: "بنطلون جينز بقصّة مستقيمة." },
  { name: "Sweatshirt", nameAr: "سويت شيرت", price: 600, aliases: ["سويت شيرت", "sweatshirt"], desc: "Crewneck sweatshirt.", descAr: "سويت شيرت برقبة دائرية." },
];

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error("Refusing to seed demo data in production (set ALLOW_DEMO_SEED=true to override explicitly).");
  }
  // Tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: "yasez-fashion" },
    update: {},
    create: {
      slug: "yasez-fashion",
      name: "YASEZ Fashion",
      description: "Modern Egyptian streetwear store.",
      industry: "CLOTHING",
      currency: "EGP",
      language: "ar",
      timezone: "Africa/Cairo",
      contactPhone: "01000000000",
      address: "Nasr City, Cairo",
      returnPolicy: "Returns within 14 days with tags attached.",
      exchangePolicy: "Exchange within 14 days for a different size/color subject to stock.",
      cancelPolicy: "Orders can be cancelled before PROCESSING.",
      shippingPolicy: "Delivery 2-4 working days inside Cairo/Giza.",
      paymentMethods: ["CASH_ON_DELIVERY", "BANK_TRANSFER"],
      requirePhoneVerify: true,
      aiPersonality: "friendly",
      aiTone: "friendly",
      aiLanguage: "ar-EG",
      aiGreeting: "أهلاً بيك في YASEZ ❤️ أقدر أساعدك إزاي؟",
      aiInstructions: "Always check real inventory via tools. Never invent stock or prices.",
    },
  });

  // Owner
  const passwordHash = await bcrypt.hash("Yasez123!", 10);
  const user = await prisma.user.upsert({
    where: { email: "owner@yasez.fashion" },
    update: {},
    create: { email: "owner@yasez.fashion", name: "Yasez Owner", passwordHash },
  });
  await prisma.membership.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
    update: { role: "OWNER" },
    create: { tenantId: tenant.id, userId: user.id, role: "OWNER" },
  });

  // Demo/development plan: unlimited scale so the demo store, playground,
  // and test suites never throttle. Real tenants start on starter via
  // getSubscription(). Never seed this in production (guarded in main()).
  const scale = await prisma.plan.upsert({
    where: { slug: "scale" },
    update: {},
    create: { slug: "scale", name: "Scale", maxAiMessages: null, maxProducts: null, maxSeats: null, maxDocuments: null, maxChannels: null },
  });
  await prisma.subscription.upsert({
    where: { tenantId: tenant.id },
    update: { planId: scale.id, status: "ACTIVE" },
    create: { tenantId: tenant.id, planId: scale.id, status: "ACTIVE" },
  });

  // Delivery zones
  for (const z of [
    { name: "Cairo", nameAr: "القاهرة", fee: 60, eta: "2-4 days" },
    { name: "Giza", nameAr: "الجيزة", fee: 70, eta: "2-4 days" },
    { name: "Alexandria", nameAr: "الإسكندرية", fee: 100, eta: "3-5 days" },
  ]) {
    await prisma.deliveryZone.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: z.name } },
      update: { fee: z.fee },
      create: { tenantId: tenant.id, ...z },
    });
  }

  // Category
  const cat = await prisma.category.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: "clothing" } },
    update: {},
    create: { tenantId: tenant.id, name: "Clothing", nameAr: "ملابس", slug: "clothing" },
  });

  for (const p of PRODUCTS) {
    const product = await prisma.product.upsert({
      where: { id: `seed-${tenant.slug}-${p.name}` },
      update: {},
      create: {
        id: `seed-${tenant.slug}-${p.name}`,
        tenantId: tenant.id,
        categoryId: cat.id,
        name: p.name,
        nameAr: p.nameAr,
        description: p.desc,
        descriptionAr: p.descAr,
        basePrice: p.price,
        currency: "EGP",
        aliases: p.aliases,
        active: true,
      },
    }).catch(async () => {
      // fallback: find by name
      const found = await prisma.product.findFirst({ where: { tenantId: tenant.id, name: p.name } });
      if (!found) throw new Error(`seed product missing: ${p.name}`);
      return found;
    });

    for (const color of COLORS) {
      for (const size of SIZES) {
        const sku = `${p.name.toUpperCase().replace(/[^A-Z]+/g, "").slice(0, 4)}-${color.toUpperCase().slice(0, 3)}-${size}`;
        const qty = STOCK[p.name]?.[`${color}/${size}`] ?? 0;
        const variant = await prisma.productVariant.upsert({
          where: { tenantId_sku: { tenantId: tenant.id, sku } },
          update: {},
          create: {
            tenantId: tenant.id,
            productId: product.id,
            sku,
            price: null,
            attributes: { Color: color, Size: size },
            active: true,
          },
        });
        await prisma.inventory.upsert({
          where: { variantId: variant.id },
          update: { quantity: qty },
          create: { tenantId: tenant.id, variantId: variant.id, quantity: qty, lowThreshold: 3 },
        });
      }
    }
  }

  // Knowledge docs
  const docs = [
    { title: "Exchange Policy", type: "POLICY", content: "Exchange within 14 days for a different size or color subject to stock availability. Items must have tags attached.\nسياسة الاستبدال: يمكن الاستبدال خلال ١٤ يوم لمقاس أو لون مختلف حسب توفر المخزون." },
    { title: "Return Policy", type: "POLICY", content: "Returns within 14 days with tags attached. Refunds to original payment method.\nسياسة الاسترجاع: استرجاع خلال ١٤ يوم والتيكت موجود." },
    { title: "Shipping Policy", type: "POLICY", content: "Cairo 60 EGP (2-4 days), Giza 70 EGP, Alexandria 100 EGP. Free delivery over 1000 EGP.\nالشحن: القاهرة ٦٠ جنيه، الجيزة ٧٠، إسكندرية ١٠٠. شحن مجاني فوق ١٠٠٠ جنيه." },
    { title: "Size Guide", type: "GUIDE", content: "Oversized fit runs large. If between sizes, take the smaller size.\nدليل المقاسات: الأوفرسايز واسع، لو بين مقاسين خد الأصغر." },
    { title: "FAQ", type: "FAQ", content: "Q: الدفع إزاي؟ A: كاش عند الاستلام أو تحويل بنكي.\nQ: التوصيل بياخد قد إيه؟ A: ٢-٤ أيام عمل داخل القاهرة والجيزة." },
  ];
  for (const d of docs) {
    const existing = await prisma.document.findFirst({ where: { tenantId: tenant.id, title: d.title } });
    if (!existing) {
      await prisma.document.create({
        data: { tenantId: tenant.id, title: d.title, type: d.type, language: "ar", status: "READY", chunkCount: 1,
          chunks: { create: [{ tenantId: tenant.id, chunkIndex: 0, content: d.content, tokenCount: d.content.length }] } },
      });
    }
  }

  console.log(`Seeded tenant ${tenant.slug} (${tenant.id}) + owner@yasez.fashion / Yasez123!`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
