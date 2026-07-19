import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(_request: Request, context: RouteContext<"/api/meetings/[id]/transcript-versions/[versionId]/activate">) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const { id, versionId } = await context.params;
  const transcript = await db.transcriptVersion.findFirst({ where: { id: versionId, meetingId: id }, select: { id: true, version: true } });
  if (!transcript) return NextResponse.json({ error: "Transcript version not found" }, { status: 404 });
  const summary = await db.summaryVersion.findFirst({ where: { meetingId: id, transcriptVersionId: versionId, status: "COMPLETED" }, orderBy: { version: "desc" }, select: { id: true } });
  try {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Meeting" WHERE id = ${id} FOR UPDATE`;
      const activeJob = await tx.processingJob.findFirst({ where: { meetingId: id, state: { in: ["QUEUED", "ACTIVE", "RETRYING", "CANCEL_REQUESTED"] } }, select: { id: true } });
      if (activeJob) throw new Error("PROCESSING_ACTIVE");
      await tx.meeting.update({ where: { id }, data: { activeTranscriptVersionId: versionId, activeSummaryVersionId: summary?.id ?? null } });
      await writeAudit(tx, { userId, meetingId: id, action: "transcript.activate", entityType: "TranscriptVersion", entityId: versionId, metadata: { version: transcript.version } });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PROCESSING_ACTIVE") return NextResponse.json({ error: "Wait for active processing to finish" }, { status: 409 });
    throw error;
  }
  return NextResponse.json({ ok: true });
}
