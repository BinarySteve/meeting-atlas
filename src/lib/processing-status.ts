import type { JobKind, JobState, MeetingState, StageState } from "@prisma/client";
import { db } from "./db";
import { PIPELINE_STAGES, SUMMARY_PIPELINE_STAGES } from "./pipeline-stages";
import { redis } from "./redis";

export const ACTIVE_JOB_STATES: JobState[] = ["QUEUED", "ACTIVE", "RETRYING", "CANCEL_REQUESTED"];
export const processingChannel = (meetingId: string) => `processing-meeting-${meetingId}`;

export function calculateProcessingPercent(completedStages: number, totalStages: number, current: number | null, total: number | null, state: JobState): number {
  if (state === "COMPLETED") return 100;
  const fractional = total && current !== null ? Math.min(1, Math.max(0, current / total)) : 0;
  return totalStages > 0 ? Math.round(((completedStages + fractional) / totalStages) * 100) : 0;
}

export type ProcessingStageSnapshot = {
  id: string | null;
  stage: string;
  state: StageState;
  attempt: number;
  progressCurrent: number | null;
  progressTotal: number | null;
  progressMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
};

export type ProcessingSnapshot = {
  meetingId: string;
  meetingState: MeetingState;
  meetingStage: string | null;
  active: boolean;
  job: null | {
    id: string;
    kind: JobKind;
    state: JobState;
    activeStage: string | null;
    attempt: number;
    heartbeatAt: string | null;
    createdAt: string;
    updatedAt: string;
    error: string | null;
    stages: ProcessingStageSnapshot[];
    completedStages: number;
    totalStages: number;
    percent: number;
  };
};

export async function getProcessingSnapshot(meetingId: string): Promise<ProcessingSnapshot | null> {
  const meeting = await db.meeting.findUnique({ where: { id: meetingId }, select: { id: true, state: true, activeStage: true, jobs: { orderBy: { createdAt: "desc" }, take: 1, include: { stages: { orderBy: [{ createdAt: "asc" }, { attempt: "asc" }] } } } } });
  if (!meeting) return null;
  const job = meeting.jobs[0];
  if (!job) return { meetingId, meetingState: meeting.state, meetingStage: meeting.activeStage, active: false, job: null };
  const expected = job.kind === "SUMMARY_REGENERATION" ? [...SUMMARY_PIPELINE_STAGES] : [...PIPELINE_STAGES];
  const latest = new Map(job.stages.map((stage) => [stage.stage, stage]));
  const stages: ProcessingStageSnapshot[] = expected.map((name) => { const stage = latest.get(name); return stage ? { id: stage.id, stage: name, state: stage.state, attempt: stage.attempt, progressCurrent: stage.progressCurrent, progressTotal: stage.progressTotal, progressMessage: stage.progressMessage, startedAt: stage.startedAt?.toISOString() ?? null, completedAt: stage.completedAt?.toISOString() ?? null, error: stage.errorMessage } : { id: null, stage: name, state: "PENDING", attempt: 0, progressCurrent: null, progressTotal: null, progressMessage: null, startedAt: null, completedAt: null, error: null }; });
  const completedStages = stages.filter((stage) => stage.state === "COMPLETED").length;
  const activeStage = stages.find((stage) => stage.state === "ACTIVE");
  const percent = calculateProcessingPercent(completedStages, expected.length, activeStage?.progressCurrent ?? null, activeStage?.progressTotal ?? null, job.state);
  return { meetingId, meetingState: meeting.state, meetingStage: meeting.activeStage, active: ACTIVE_JOB_STATES.includes(job.state), job: { id: job.id, kind: job.kind, state: job.state, activeStage: job.activeStage, attempt: job.attempt, heartbeatAt: job.heartbeatAt?.toISOString() ?? null, createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString(), error: job.errorMessage, stages, completedStages, totalStages: expected.length, percent } };
}

export async function publishProcessingUpdate(meetingId: string): Promise<void> {
  await redis.publish(processingChannel(meetingId), JSON.stringify({ meetingId, at: new Date().toISOString() })).catch(() => 0);
}
