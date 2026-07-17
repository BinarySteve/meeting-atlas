import type { Prisma, PrismaClient } from "@prisma/client";

type AuditClient = PrismaClient | Prisma.TransactionClient;

export async function writeAudit(
  client: AuditClient,
  input: {
    userId?: string;
    meetingId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    metadata?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await client.auditEvent.create({ data: input });
}
