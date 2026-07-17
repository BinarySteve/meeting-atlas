import { NextResponse } from "next/server";
import { requireSession, SESSION_IDLE_SECONDS } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { assertExpectedOrigin } from "@/lib/passkeys";

export async function GET() {
  try {
    const current = await requireSession();
    const now = new Date();
    const sessions = await db.session.findMany({ where: { userId: current.userId, revokedAt: null, expiresAt: { gt: now }, lastSeenAt: { gt: new Date(now.getTime() - SESSION_IDLE_SECONDS * 1000) } }, select: { id: true, authMethod: true, deviceLabel: true, createdAt: true, lastSeenAt: true, expiresAt: true }, orderBy: { lastSeenAt: "desc" } });
    return NextResponse.json({ sessions: sessions.map((session) => ({ ...session, current: session.id === current.sessionId })) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
}

export async function POST(request: Request) {
  if (!assertExpectedOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  try {
    const current = await requireSession();
    const revokedAt = new Date();
    const count = await db.$transaction(async (tx) => {
      const result = await tx.session.updateMany({ where: { userId: current.userId, id: { not: current.sessionId }, revokedAt: null }, data: { revokedAt } });
      await writeAudit(tx, { userId: current.userId, action: "OTHER_SESSIONS_REVOKED", entityType: "Session", entityId: current.sessionId, metadata: { count: result.count } });
      return result.count;
    });
    return NextResponse.json({ ok: true, count });
  } catch { return NextResponse.json({ error: "Unable to revoke sessions." }, { status: 400 }); }
}
