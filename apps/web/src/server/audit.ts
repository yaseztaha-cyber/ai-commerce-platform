import { prisma } from "@ai-commerce/database";

export async function audit(input: {
  tenantId: string;
  actor: string;
  action: string;
  resource?: string;
  resourceId?: string;
  oldValue?: unknown;
  newValue?: unknown;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actor: input.actor,
        action: input.action,
        resource: input.resource,
        resourceId: input.resourceId,
        oldValue: (input.oldValue ?? null) as never,
        newValue: (input.newValue ?? null) as never,
      },
    });
  } catch {
    // audit must never break the main flow
  }
}
