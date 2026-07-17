import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateCurrentPassword } from "@/lib/account-security";
import { requireSession, revokeOtherSessions, rotateSession } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { assertExpectedOrigin } from "@/lib/passkeys";
import { PASSWORD_INPUT_MAX_LENGTH } from "@/lib/password-policy";

const inputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().email().max(254),
  currentPassword: z.string().max(PASSWORD_INPUT_MAX_LENGTH).optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    const profile = await db.user.findUniqueOrThrow({
      where: { id: session.userId },
      select: { name: true },
    });
    return NextResponse.json({
      profile: { name: profile.name?.trim() || "Owner" },
    });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function PATCH(request: Request) {
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
        { error: "Enter a valid name and email address." },
        { status: 400 },
      );
    const user = await db.user.findUniqueOrThrow({
      where: { id: session.userId },
      select: { email: true },
    });
    const email = parsed.data.email.toLowerCase();
    const emailChanged = email !== user.email;
    if (emailChanged) {
      if (!parsed.data.currentPassword)
        return NextResponse.json(
          { error: "Current password is required to change your login email." },
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
    }
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: session.userId },
        data: { name: parsed.data.name, email },
      });
      await writeAudit(tx, {
        userId: session.userId,
        action: emailChanged ? "EMAIL_CHANGED" : "PROFILE_UPDATED",
        entityType: "Account",
        entityId: session.userId,
      });
    });
    if (emailChanged) {
      await revokeOtherSessions(session.userId);
      await rotateSession(session);
    }
    return NextResponse.json({
      ok: true,
      profile: { name: parsed.data.name, email },
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      error.code === "P2002"
    )
      return NextResponse.json(
        { error: "That email address is already in use." },
        { status: 409 },
      );
    return NextResponse.json(
      { error: "Unable to update profile." },
      { status: 400 },
    );
  }
}
