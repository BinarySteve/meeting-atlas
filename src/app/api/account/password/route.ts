import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateCurrentPassword } from "@/lib/account-security";
import { requireSession } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { assertExpectedOrigin } from "@/lib/passkeys";
import {
  hashPassword,
  validateNewPassword,
  verifyPasswordHash,
} from "@/lib/passwords";
import { PASSWORD_INPUT_MAX_LENGTH } from "@/lib/password-policy";

const inputSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_INPUT_MAX_LENGTH),
  newPassword: z.string().min(1).max(PASSWORD_INPUT_MAX_LENGTH),
});

export async function POST(request: Request) {
  if (!assertExpectedOrigin(request))
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  try {
    const session = await requireSession();
    const parsed = inputSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return NextResponse.json(
        { error: "Invalid password input." },
        { status: 400 },
      );
    const reauthentication = await authenticateCurrentPassword(
      session.userId,
      parsed.data.currentPassword,
    );
    if (reauthentication !== "valid")
      return NextResponse.json(
        {
          error:
            reauthentication === "blocked"
              ? "Too many attempts. Try again later."
              : "Current password is incorrect",
        },
        { status: reauthentication === "blocked" ? 429 : 401 },
      );
    const user = await db.user.findUniqueOrThrow({
      where: { id: session.userId },
      select: { name: true, email: true, passwordHash: true },
    });
    const policy = validateNewPassword(parsed.data.newPassword, [
      user.name ?? "",
      user.email,
      user.email.split("@")[0] ?? "",
    ]);
    if (!policy.password)
      return NextResponse.json({ error: policy.error }, { status: 400 });
    if (await verifyPasswordHash(user.passwordHash, policy.password))
      return NextResponse.json(
        { error: "New password must differ from your current password." },
        { status: 400 },
      );
    const passwordHash = await hashPassword(policy.password);
    const changedAt = new Date();
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: session.userId },
        data: { passwordHash, passwordChangedAt: changedAt },
      });
      await tx.session.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: changedAt },
      });
      await writeAudit(tx, {
        userId: session.userId,
        action: "PASSWORD_CHANGED",
        entityType: "Account",
        entityId: session.userId,
      });
    });
    (await cookies()).delete("meeting_session");
    return NextResponse.json({ ok: true, reauthenticate: true });
  } catch {
    return NextResponse.json(
      { error: "Unable to change password." },
      { status: 400 },
    );
  }
}
