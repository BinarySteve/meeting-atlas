import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { hashPassword, validateNewPassword } from "../src/lib/passwords";
import { PASSWORD_INPUT_MAX_LENGTH } from "../src/lib/password-policy";

const input = z
  .object({ OWNER_PASSWORD: z.string().min(1).max(PASSWORD_INPUT_MAX_LENGTH) })
  .parse(process.env);
const db = new PrismaClient();

async function main(): Promise<void> {
  try {
    const owners = await db.user.findMany({
      select: { id: true, email: true, name: true },
      take: 2,
    });
    if (owners.length !== 1)
      throw new Error(
        `Expected exactly one owner account; found ${owners.length}.`,
      );
    const owner = owners[0];
    const policy = validateNewPassword(input.OWNER_PASSWORD, [
      owner.email,
      owner.email.split("@")[0] ?? "",
      owner.name ?? "",
    ]);
    if (!policy.password) throw new Error(policy.error);
    const passwordHash = await hashPassword(policy.password);
    const changedAt = new Date();
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: owner.id },
        data: { passwordHash, passwordChangedAt: changedAt },
      });
      await tx.session.updateMany({
        where: { userId: owner.id, revokedAt: null },
        data: { revokedAt: changedAt },
      });
      await tx.auditEvent.create({
        data: {
          userId: owner.id,
          action: "PASSWORD_RESET_CLI",
          entityType: "Account",
          entityId: owner.id,
        },
      });
    });
    console.log(
      "Owner password reset. All sessions were revoked; sign in again.",
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Owner password reset failed",
  );
  process.exitCode = 1;
});
