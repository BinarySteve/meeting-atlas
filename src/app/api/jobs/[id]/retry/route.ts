import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueuePipeline } from "@/lib/queue";
import { writeAudit } from "@/lib/audit";
import { publishProcessingUpdate } from "@/lib/processing-status";

export async function POST(_request: Request, context: RouteContext<"/api/jobs/[id]/retry">) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const { id } = await context.params;
  const job = await db.processingJob.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (["ACTIVE", "QUEUED", "RETRYING", "CANCEL_REQUESTED"].includes(job.state)) return NextResponse.json({ error: "Job is already active" }, { status: 409 });
  await db.$transaction(async (tx) => {
    await tx.processingJob.update({ where: { id }, data: { state: "QUEUED", errorCode: null, errorMessage: null } });
    await writeAudit(tx, { userId, meetingId: job.meetingId, action: "processing.retry", entityType: "ProcessingJob", entityId: id });
  });
  try {
    const bullJobId = await enqueuePipeline(id, job.attempt);
    await db.processingJob.update({ where: { id }, data: { bullJobId } });
    await publishProcessingUpdate(job.meetingId);
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (error) {
    await db.processingJob.update({ where: { id }, data: { state: "FAILED", errorMessage: error instanceof Error ? error.message : "Queue unavailable" } });
    await publishProcessingUpdate(job.meetingId);
    return NextResponse.json({ error: "Retry saved, but queue is unavailable" }, { status: 503 });
  }
}
