import { NextResponse } from "next/server";
import { authenticateCurrentPassword } from "@/lib/account-security";
import { requireUserId, revokeOtherSessions } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { assertExpectedOrigin } from "@/lib/passkeys";

export async function DELETE(
  request: Request,
  context: RouteContext<"/api/account/passkeys/[id]">,
) {
  if (!assertExpectedOrigin(request))
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  try {
    const userId = await requireUserId();
    const body = (await request.json().catch(() => null)) as {
      currentPassword?: string;
    } | null;
    if (!body?.currentPassword)
      return NextResponse.json(
        { error: "Current password is required" },
        { status: 400 },
      );
    const reauthentication = await authenticateCurrentPassword(
      userId,
      body.currentPassword,
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
    const { id } = await context.params;
    const deleted = await db.$transaction(async (tx) => {
      const result = await tx.passkey.deleteMany({ where: { id, userId } });
      if (result.count)
        await writeAudit(tx, {
          userId,
          action: "PASSKEY_REVOKED",
          entityType: "Passkey",
          entityId: id,
        });
      return result.count;
    });
    if (!deleted)
      return NextResponse.json({ error: "Passkey not found" }, { status: 404 });
    await revokeOtherSessions(userId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Unable to revoke passkey" },
      { status: 400 },
    );
  }
}
