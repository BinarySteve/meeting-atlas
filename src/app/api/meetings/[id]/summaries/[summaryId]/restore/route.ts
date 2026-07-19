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
  try {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Meeting" WHERE id = ${id} FOR UPDATE`;
      const activeJob = await tx.processingJob.findFirst({ where: { meetingId: id, state: { in: ["QUEUED", "ACTIVE", "RETRYING", "CANCEL_REQUESTED"] } }, select: { id: true } });
      if (activeJob) throw new Error("PROCESSING_ACTIVE");
      await tx.meeting.update({ where: { id }, data: { activeSummaryVersionId: summaryId, activeTranscriptVersionId: summary.transcriptVersionId } });
      await writeAudit(tx, { userId, meetingId: id, action: "summary.restore", entityType: "SummaryVersion", entityId: summaryId, metadata: { version: summary.version } });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PROCESSING_ACTIVE") return NextResponse.json({ error: "Wait for active processing to finish" }, { status: 409 });
    throw error;
  }
  return NextResponse.json({ ok: true });
}
