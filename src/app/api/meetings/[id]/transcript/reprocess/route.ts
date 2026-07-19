import { stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProcessingSnapshot, publishProcessingUpdate } from "@/lib/processing-status";
import { enqueuePipeline } from "@/lib/queue";
import { resolveStorageKey } from "@/lib/storage";

export async function POST(_request: Request, context: RouteContext<"/api/meetings/[id]/transcript/reprocess">) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const { id } = await context.params;
  const meeting = await db.meeting.findUnique({
    where: { id },
    include: { activeTranscriptVersion: true, recordings: { orderBy: { createdAt: "asc" }, take: 1 } },
  });
  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  if (!meeting.activeTranscriptVersion) return NextResponse.json({ error: "Meeting has no active transcript" }, { status: 409 });
  if (meeting.activeTranscriptVersion.source === "MANUAL") {
    return NextResponse.json({ error: "Select a machine transcript version before reprocessing", code: "MANUAL_TRANSCRIPT_PROTECTED" }, { status: 409 });
  }
  const recording = meeting.recordings[0];
  if (!recording) return NextResponse.json({ error: "Meeting recording is unavailable" }, { status: 409 });
  const original = await stat(await resolveStorageKey(recording.storageKey)).catch(() => null);
  if (!original?.isFile()) return NextResponse.json({ error: "Restore the original recording before reprocessing", code: "RECORDING_UNAVAILABLE" }, { status: 409 });
  const active = await db.processingJob.findFirst({ where: { meetingId: id, state: { in: ["QUEUED", "ACTIVE", "RETRYING", "CANCEL_REQUESTED"] } } });
  if (active) return NextResponse.json({ error: "Processing is already running", jobId: active.id, processing: await getProcessingSnapshot(id) }, { status: 409 });
  let job;
  try {
    job = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Meeting" WHERE id = ${id} FOR UPDATE`;
      const current = await tx.meeting.findUnique({ where: { id }, include: { activeTranscriptVersion: true } });
      if (!current?.activeTranscriptVersion) throw new Error("NO_ACTIVE_TRANSCRIPT");
      if (current.activeTranscriptVersion.source === "MANUAL") throw new Error("MANUAL_TRANSCRIPT_PROTECTED");
      const activeJob = await tx.processingJob.findFirst({ where: { meetingId: id, state: { in: ["QUEUED", "ACTIVE", "RETRYING", "CANCEL_REQUESTED"] } }, select: { id: true } });
      if (activeJob) throw new Error("PROCESSING_ACTIVE");
      const created = await tx.processingJob.create({ data: { meetingId: id, kind: "TRANSCRIPT_REPROCESS", targetTranscriptVersionId: current.activeTranscriptVersion.id } });
      await writeAudit(tx, { userId, meetingId: id, action: "transcript.reprocess", entityType: "ProcessingJob", entityId: created.id, metadata: { sourceTranscriptVersionId: current.activeTranscriptVersion.id } });
      return created;
    });
  } catch (error) {
    const concurrent = await db.processingJob.findFirst({ where: { meetingId: id, state: { in: ["QUEUED", "ACTIVE", "RETRYING", "CANCEL_REQUESTED"] } }, orderBy: { createdAt: "desc" } });
    if (concurrent) return NextResponse.json({ error: "Processing is already running", jobId: concurrent.id, processing: await getProcessingSnapshot(id) }, { status: 409 });
    const current = await db.meeting.findUnique({ where: { id }, include: { activeTranscriptVersion: true } });
    if (!current?.activeTranscriptVersion) return NextResponse.json({ error: "Meeting has no active transcript" }, { status: 409 });
    if (current.activeTranscriptVersion.source === "MANUAL") return NextResponse.json({ error: "Select a machine transcript version before reprocessing", code: "MANUAL_TRANSCRIPT_PROTECTED" }, { status: 409 });
    throw error;
  }
  try {
    const bullJobId = await enqueuePipeline(job.id, job.attempt);
    await db.processingJob.update({ where: { id: job.id }, data: { bullJobId } });
  } catch (error) {
    await db.processingJob.update({ where: { id: job.id }, data: { state: "FAILED", errorMessage: error instanceof Error ? error.message : "Queue unavailable" } });
    await publishProcessingUpdate(id);
    return NextResponse.json({ error: "Reprocessing was saved but could not be queued", processing: await getProcessingSnapshot(id) }, { status: 503 });
  }
  await publishProcessingUpdate(id);
  return NextResponse.json({ jobId: job.id, processing: await getProcessingSnapshot(id) }, { status: 202 });
}
