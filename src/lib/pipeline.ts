import { StageState } from "@prisma/client";
import { db } from "./db";
import { logger } from "./logger";
import type { PipelineStage } from "./pipeline-stages";
import { publishProcessingUpdate } from "./processing-status";

export { PIPELINE_STAGES } from "./pipeline-stages";

export async function completedStages(jobId: string): Promise<Set<string>> {
  const rows = await db.processingStageAttempt.findMany({ where: { jobId, state: StageState.COMPLETED }, select: { stage: true } });
  return new Set(rows.map((row) => row.stage));
}

export async function runStage<T>(jobId: string, stage: PipelineStage, operation: (stageAttemptId: string, signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
  const job = await db.processingJob.findUniqueOrThrow({ where: { id: jobId }, select: { state: true, meetingId: true } });
  if (job.state === "CANCEL_REQUESTED" || job.state === "CANCELLED") {
    await db.$transaction([
      db.processingJob.update({ where: { id: jobId }, data: { state: "CANCELLED", activeStage: null } }),
      db.meeting.update({ where: { id: job.meetingId }, data: { state: "CANCELLED", activeStage: null } }),
    ]);
    throw new Error("JOB_CANCELLED");
  }
  const prior = await db.processingStageAttempt.findFirst({ where: { jobId, stage, state: StageState.COMPLETED } });
  if (prior) return undefined;
  const count = await db.processingStageAttempt.count({ where: { jobId, stage } });
  const attempt = count + 1;
  const row = await db.processingStageAttempt.create({ data: { jobId, stage, attempt, state: StageState.ACTIVE, startedAt: new Date(), progressCurrent: 0, progressMessage: "Starting", idempotencyKey: `${jobId}:${stage}:${attempt}` } });
  const startedAt = performance.now();
  logger.info({ event: "stage_started", jobId, meetingId: job.meetingId, stage, attempt });
  await db.$transaction([
    db.processingJob.update({ where: { id: jobId }, data: { activeStage: stage, state: "ACTIVE", heartbeatAt: new Date() } }),
    db.meeting.update({ where: { id: job.meetingId }, data: { activeStage: stage, state: "PROCESSING" } }),
  ]);
  await publishProcessingUpdate(job.meetingId);
  const controller = new AbortController();
  let checking = false;
  const cancellationPoll = setInterval(() => {
    if (checking || controller.signal.aborted) return;
    checking = true;
    void db.processingJob.findUnique({ where: { id: jobId }, select: { state: true } })
      .then((current) => { if (current?.state === "CANCEL_REQUESTED" || current?.state === "CANCELLED") controller.abort(new Error("JOB_CANCELLED")); })
      .finally(() => { checking = false; });
  }, 1_000);
  cancellationPoll.unref();
  const heartbeat = setInterval(() => { void db.processingJob.update({ where: { id: jobId }, data: { heartbeatAt: new Date() } }).catch(() => undefined); }, 10_000);
  heartbeat.unref();
  try {
    const result = await operation(row.id, controller.signal);
    const current = await db.processingJob.findUniqueOrThrow({ where: { id: jobId }, select: { state: true } });
    if (controller.signal.aborted || current.state === "CANCEL_REQUESTED" || current.state === "CANCELLED") throw new Error("JOB_CANCELLED");
    await db.$transaction([
      db.processingStageAttempt.update({ where: { id: row.id }, data: { state: StageState.COMPLETED, completedAt: new Date(), progressMessage: "Complete", result: JSON.parse(JSON.stringify(result ?? null)) } }),
      db.processingJob.update({ where: { id: jobId }, data: { heartbeatAt: new Date() } }),
    ]);
    await publishProcessingUpdate(job.meetingId);
    logger.info({ event: "stage_completed", jobId, meetingId: job.meetingId, stage, attempt, durationMs: Math.round(performance.now() - startedAt) });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown stage failure";
    const current = await db.processingJob.findUnique({ where: { id: jobId }, select: { state: true } });
    const cancelled = controller.signal.aborted || message === "JOB_CANCELLED" || current?.state === "CANCEL_REQUESTED" || current?.state === "CANCELLED";
    if (cancelled) {
      await db.$transaction([
        db.processingStageAttempt.update({ where: { id: row.id }, data: { state: StageState.CANCELLED, completedAt: new Date(), errorMessage: null } }),
        db.processingJob.update({ where: { id: jobId }, data: { state: "CANCELLED", activeStage: null } }),
        db.meeting.update({ where: { id: job.meetingId }, data: { state: "CANCELLED", activeStage: null } }),
      ]);
      await publishProcessingUpdate(job.meetingId);
      logger.info({ event: "stage_cancelled", jobId, meetingId: job.meetingId, stage, attempt, durationMs: Math.round(performance.now() - startedAt) });
      throw new Error("JOB_CANCELLED");
    }
    await db.processingStageAttempt.update({ where: { id: row.id }, data: { state: StageState.FAILED, completedAt: new Date(), progressMessage: "Failed", errorMessage: message.slice(0, 2000) } });
    await publishProcessingUpdate(job.meetingId);
    logger.error({ event: "stage_failed", jobId, meetingId: job.meetingId, stage, attempt, durationMs: Math.round(performance.now() - startedAt), error: message.slice(0, 500) });
    throw error;
  } finally {
    clearInterval(cancellationPoll);
    clearInterval(heartbeat);
  }
}
