import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { enqueuePipeline } from "@/lib/queue";
import { getProcessingSnapshot, publishProcessingUpdate } from "@/lib/processing-status";

const bodySchema = z.object({ transcriptVersionId: z.string().min(1) });

export async function POST(request: Request, context: RouteContext<"/api/meetings/[id]/summaries/regenerate">) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid transcript version" }, { status: 400 });
  const { id } = await context.params;
  const transcript = await db.transcriptVersion.findFirst({ where: { id: parsed.data.transcriptVersionId, meetingId: id } });
  if (!transcript) return NextResponse.json({ error: "Transcript version not found" }, { status: 404 });
  const active = await db.processingJob.findFirst({ where: { meetingId: id, state: { in: ["QUEUED", "ACTIVE", "RETRYING", "CANCEL_REQUESTED"] } } });
  if (active) return NextResponse.json({ error: "Processing is already running", jobId: active.id, processing: await getProcessingSnapshot(id) }, { status: 409 });
  let job;
  try {
    job = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Meeting" WHERE id = ${id} FOR UPDATE`;
      const current = await tx.meeting.findUnique({ where: { id }, select: { activeTranscriptVersionId: true } });
      if (current?.activeTranscriptVersionId !== transcript.id) throw new Error("TRANSCRIPT_NOT_ACTIVE");
      const activeJob = await tx.processingJob.findFirst({ where: { meetingId: id, state: { in: ["QUEUED", "ACTIVE", "RETRYING", "CANCEL_REQUESTED"] } }, select: { id: true } });
      if (activeJob) throw new Error("PROCESSING_ACTIVE");
      const created = await tx.processingJob.create({ data: { meetingId: id, kind: "SUMMARY_REGENERATION", targetTranscriptVersionId: transcript.id } });
      await writeAudit(tx, { userId, meetingId: id, action: "summary.regenerate", entityType: "ProcessingJob", entityId: created.id, metadata: { transcriptVersionId: transcript.id } });
      return created;
    });
  } catch (error) {
    const concurrent = await db.processingJob.findFirst({ where: { meetingId: id, state: { in: ["QUEUED", "ACTIVE", "RETRYING", "CANCEL_REQUESTED"] } }, orderBy: { createdAt: "desc" } });
    if (concurrent) return NextResponse.json({ error: "Processing is already running", jobId: concurrent.id, processing: await getProcessingSnapshot(id) }, { status: 409 });
    if (error instanceof Error && error.message === "TRANSCRIPT_NOT_ACTIVE") return NextResponse.json({ error: "Activate this transcript version before regenerating its summary" }, { status: 409 });
    throw error;
  }
  try {
    const bullJobId = await enqueuePipeline(job.id, job.attempt);
    await db.processingJob.update({ where: { id: job.id }, data: { bullJobId } });
    await publishProcessingUpdate(id);
  } catch (error) {
    await db.processingJob.update({ where: { id: job.id }, data: { state: "FAILED", errorMessage: error instanceof Error ? error.message : "Queue unavailable" } });
    await publishProcessingUpdate(id);
    return NextResponse.json({ error: "Summary job stored but queue unavailable", jobId: job.id }, { status: 503 });
  }
  return NextResponse.json({ ok: true, jobId: job.id, processing: await getProcessingSnapshot(id) }, { status: 202 });
}
