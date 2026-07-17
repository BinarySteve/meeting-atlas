import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { assertExpectedOrigin } from "@/lib/passkeys";

export async function DELETE(request: Request, context: RouteContext<"/api/account/sessions/[id]">) {
  if (!assertExpectedOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  try {
    const current = await requireSession();
    const { id } = await context.params;
    if (id === current.sessionId) return NextResponse.json({ error: "Use Sign out to end this session." }, { status: 400 });
    const revokedAt = new Date();
    const count = await db.$transaction(async (tx) => {
      const result = await tx.session.updateMany({ where: { id, userId: current.userId, revokedAt: null }, data: { revokedAt } });
      if (result.count) await writeAudit(tx, { userId: current.userId, action: "SESSION_REVOKED", entityType: "Session", entityId: id });
      return result.count;
    });
    if (!count) return NextResponse.json({ error: "Session not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Unable to revoke session." }, { status: 400 }); }
}
