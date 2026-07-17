import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { pipelineQueue } from "@/lib/queue";
import { writeAudit } from "@/lib/audit";
import { publishProcessingUpdate } from "@/lib/processing-status";

export async function POST(_request: Request, context: RouteContext<"/api/jobs/[id]/cancel">) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const { id } = await context.params;
  const job = await db.processingJob.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(job.state)) return NextResponse.json({ error: "Job is not active" }, { status: 409 });
  await db.$transaction(async (tx) => {
    await tx.processingJob.update({ where: { id }, data: { state: "CANCEL_REQUESTED" } });
    await writeAudit(tx, { userId, meetingId: job.meetingId, action: "processing.cancel", entityType: "ProcessingJob", entityId: id });
  });
  if (job.bullJobId) {
    const queued = await pipelineQueue.getJob(job.bullJobId);
    if (queued && (await queued.getState()) === "waiting") {
      await queued.remove();
      await db.$transaction([
        db.processingJob.update({ where: { id }, data: { state: "CANCELLED", activeStage: null } }),
        db.meeting.update({ where: { id: job.meetingId }, data: { state: "CANCELLED", activeStage: null } }),
      ]);
    }
  }
  await publishProcessingUpdate(job.meetingId);
  return NextResponse.json({ ok: true }, { status: 202 });
}
