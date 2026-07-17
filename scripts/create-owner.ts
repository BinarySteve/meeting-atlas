import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { hashPassword, validateNewPassword } from "../src/lib/passwords";
import { PASSWORD_INPUT_MAX_LENGTH } from "../src/lib/password-policy";

const input = z
  .object({
    OWNER_EMAIL: z.string().email(),
    OWNER_PASSWORD: z.string().min(1).max(PASSWORD_INPUT_MAX_LENGTH),
    OWNER_NAME: z.string().trim().min(1).max(80).optional(),
  })
  .parse(process.env);
const db = new PrismaClient();

async function main(): Promise<void> {
  try {
    const existing = await db.user.findMany({ select: { id: true }, take: 2 });
    if (existing.length)
      throw new Error(
        "Owner account already exists. Use npm run owner:reset-password to recover access.",
      );
    const policy = validateNewPassword(input.OWNER_PASSWORD, [
      input.OWNER_EMAIL,
      input.OWNER_EMAIL.split("@")[0] ?? "",
      input.OWNER_NAME ?? "",
    ]);
    if (!policy.password) throw new Error(policy.error);
    const passwordHash = await hashPassword(policy.password);
    await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.OWNER_EMAIL.toLowerCase(),
          name: input.OWNER_NAME,
          passwordHash,
          passwordChangedAt: new Date(),
        },
      });
      await tx.auditEvent.create({
        data: {
          userId: user.id,
          action: "OWNER_CREATED",
          entityType: "Account",
          entityId: user.id,
        },
      });
    });
    console.log("Owner account created");
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Owner creation failed",
  );
  process.exitCode = 1;
});
