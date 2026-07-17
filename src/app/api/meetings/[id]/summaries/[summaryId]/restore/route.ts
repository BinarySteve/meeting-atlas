import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";

export async function POST(_request: Request, context: RouteContext<"/api/meetings/[id]/summaries/[summaryId]/restore">) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const { id, summaryId } = await context.params;
  const summary = await db.summaryVersion.findFirst({ where: { id: summaryId, meetingId: id, status: "COMPLETED" } });
  if (!summary) return NextResponse.json({ error: "Completed summary not found" }, { status: 404 });
  await db.$transaction(async (tx) => {
    await tx.meeting.update({ where: { id }, data: { activeSummaryVersionId: summaryId } });
    await writeAudit(tx, { userId, meetingId: id, action: "summary.restore", entityType: "SummaryVersion", entityId: summaryId, metadata: { version: summary.version } });
  });
  return NextResponse.json({ ok: true });
}
