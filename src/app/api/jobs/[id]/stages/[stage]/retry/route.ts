import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { PIPELINE_STAGES } from "@/lib/pipeline";
import { enqueuePipeline } from "@/lib/queue";
import { publishProcessingUpdate } from "@/lib/processing-status";

export async function POST(_request: Request, context: RouteContext<"/api/jobs/[id]/stages/[stage]/retry">) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const { id, stage } = await context.params;
  if (!PIPELINE_STAGES.includes(stage as (typeof PIPELINE_STAGES)[number])) return NextResponse.json({ error: "Unknown stage" }, { status: 400 });
  const job = await db.processingJob.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (["ACTIVE", "QUEUED", "RETRYING", "CANCEL_REQUESTED"].includes(job.state)) return NextResponse.json({ error: "Job is active" }, { status: 409 });
  const failed = await db.processingStageAttempt.findFirst({ where: { jobId: id, stage, state: "FAILED" }, orderBy: { attempt: "desc" } });
  if (!failed) return NextResponse.json({ error: "Stage has no failed attempt" }, { status: 409 });
  await db.$transaction(async (tx) => {
    await tx.processingJob.update({ where: { id }, data: { state: "QUEUED", errorCode: null, errorMessage: null } });
    await writeAudit(tx, { userId, meetingId: job.meetingId, action: "processing.stage_retry", entityType: "ProcessingStageAttempt", entityId: failed.id, metadata: { stage } });
  });
  try {
    const bullJobId = await enqueuePipeline(id, job.attempt);
    await db.processingJob.update({ where: { id }, data: { bullJobId } });
    await publishProcessingUpdate(job.meetingId);
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (error) {
    await db.processingJob.update({ where: { id }, data: { state: "FAILED", errorMessage: error instanceof Error ? error.message : "Queue unavailable" } });
    await publishProcessingUpdate(job.meetingId);
    return NextResponse.json({ error: "Stage retry saved, but queue is unavailable" }, { status: 503 });
  }
}
