import { Errors, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession } from "@/server/auth";
import { config } from "@/lib/env";
import { prisma } from "@ai-commerce/database";

export async function GET() {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);

  const whatsappConfigured = Boolean(config.whatsapp.accessToken && config.whatsapp.phoneNumberId && config.whatsapp.appSecret);
  const instagramConfigured = Boolean(config.instagram.accessToken && config.instagram.userId && config.instagram.appSecret);
  const messengerConfigured = Boolean(config.messenger.accessToken && config.messenger.pageId && config.messenger.appSecret);

  const tenant = await prisma.tenant.findUnique({ where: { id: s.tenantId }, select: { slug: true } });

  return ok(
    {
      tenant: { slug: tenant?.slug ?? "" },
      channels: {
        whatsapp: { configured: whatsappConfigured, env: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET"] },
        instagram: { configured: instagramConfigured, env: ["INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_USER_ID", "INSTAGRAM_APP_SECRET"] },
        messenger: { configured: messengerConfigured, env: ["MESSENGER_ACCESS_TOKEN", "MESSENGER_PAGE_ID", "MESSENGER_APP_SECRET"] },
        webchat: { configured: true, env: [] },
      },
    },
    { requestId }
  );
}