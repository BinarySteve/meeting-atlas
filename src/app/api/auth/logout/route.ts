import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";
import { assertExpectedOrigin } from "@/lib/passkeys";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  if (!assertExpectedOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const session = await clearSession();
  if (session) await writeAudit(db, { userId: session.userId, action: "SIGNED_OUT", entityType: "Session", entityId: session.sessionId });
  return NextResponse.json({ ok: true });
}
