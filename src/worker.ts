import { Worker } from "bullmq";
import IORedis from "ioredis";
import { db } from "./lib/db";
import { getEnv } from "./lib/env";
import { inspectMedia, normalizeMedia } from "./lib/media";
import { PIPELINE_QUEUE, redisConnection } from "./lib/queue";
import { newStorageKey, removeStorageKey, resolveStorageKey } from "./lib/storage";
import { writeJsonArtifact } from "./lib/storage";
import { PIPELINE_STAGES, runStage } from "./lib/pipeline";
import { streamProcessingRequest } from "./lib/processing-client";
import { assembleWhisperCppResponse, extractWhisperWords, parseTranscriptionTimeline } from "./lib/transcription";
import { alignWordsToSpeakers, parseDiarization } from "./lib/alignment";
import { readFile } from "node:fs/promises";
import { runSummaryPipeline } from "./lib/summary-pipeline";
import type { Prisma } from "@prisma/client";
import { logger } from "./lib/logger";
import { publishProcessingUpdate } from "./lib/processing-status";

const redisForHeartbeat = new IORedis(getEnv().REDIS_URL, { maxRetriesPerRequest: null });
const workerHeartbeat = setInterval(() => {
  void redisForHeartbeat.set("health:worker", new Date().toISOString(), "EX", 30);
}, 10_000);
workerHeartbeat.unref();
void redisForHeartbeat.set("health:worker", new Date().toISOString(), "EX", 30);

new Worker<{ jobId: string }>(PIPELINE_QUEUE, async (bullJob) => {
  const job = await db.processingJob.findUniqueOrThrow({ where: { id: bullJob.data.jobId }, include: { meeting: { include: { recordings: true } } } });
  const recording = job.meeting.recordings[0];
  if (!recording) throw new Error("Meeting has no recording");
  await db.processingJob.update({ where: { id: job.id }, data: { attempt: { increment: 1 }, state: "ACTIVE", heartbeatAt: new Date() } });
  await db.meeting.update({ where: { id: job.meetingId }, data: { state: "PROCESSING" } });
  await publishProcessingUpdate(job.meetingId);
  if (job.kind === "SUMMARY_REGENERATION") {
    if (!job.targetTranscriptVersionId) throw new Error("Summary job has no target transcript version");
    await runSummaryPipeline(job.id, job.meetingId, job.targetTranscriptVersionId);
    await runStage(job.id, "completion", async () => {
      await db.$transaction([
        db.processingJob.update({ where: { id: job.id }, data: { state: "COMPLETED", activeStage: null } }),
        db.meeting.update({ where: { id: job.meetingId }, data: { state: "COMPLETED", activeStage: null } }),
      ]);
      return { saved: true, summaryOnly: true };
    });
    return;
  }
  const reprocessing = job.kind === "TRANSCRIPT_REPROCESS";
  if (reprocessing && !job.targetTranscriptVersionId) throw new Error("Reprocessing job has no source transcript version");
  const original = await resolveStorageKey(recording.storageKey);
  if (!reprocessing) await runStage(job.id, "upload_validation", async () => ({ byteSize: recording.byteSize.toString(), sha256: recording.sha256 }));
  await runStage(job.id, "audio_inspection", async (_stageAttemptId, signal) => {
    const info = await inspectMedia(original, signal);
    await db.recording.update({ where: { id: recording.id }, data: { detectedFormat: info.format, durationMs: info.durationMs, sampleRate: info.sampleRate, channels: info.channels, mediaMetadata: info.raw as Prisma.InputJsonValue } });
    return { format: info.format, durationMs: info.durationMs.toString() };
  });
  await runStage(job.id, "audio_normalization", async (_stageAttemptId, signal) => {
    const refreshed = await db.recording.findUniqueOrThrow({ where: { id: recording.id } });
    if (reprocessing && refreshed.normalizedStorageKey && refreshed.durationMs) {
      try {
        const normalized = await inspectMedia(await resolveStorageKey(refreshed.normalizedStorageKey), signal);
        if (Math.abs(Number(normalized.durationMs - refreshed.durationMs)) <= 1_000) {
          return { storageKey: refreshed.normalizedStorageKey, reused: true, durationMs: normalized.durationMs.toString() };
        }
      } catch { /* Regenerate a missing or invalid derived file from the immutable original. */ }
    }
    const key = newStorageKey("normalized", "wav");
    try { await normalizeMedia(original, await resolveStorageKey(key), signal); }
    catch (error) { await removeStorageKey(key); throw error; }
    await db.recording.update({ where: { id: recording.id }, data: { normalizedStorageKey: key } });
    if (refreshed.normalizedStorageKey && refreshed.normalizedStorageKey !== key) await removeStorageKey(refreshed.normalizedStorageKey);
    return { storageKey: key };
  });
  const env = getEnv();
  if (env.PROCESSING_MODE === "simulation" && (!env.ALLOW_SIMULATION || process.env.NODE_ENV === "production")) throw new Error("Simulation mode forbidden by environment policy");
  if (env.PROCESSING_MODE === "remote") {
    await runStage(job.id, "speech_transcription", async (stageAttemptId, signal) => {
      const refreshed = await db.recording.findUniqueOrThrow({ where: { id: recording.id } });
      if (!refreshed.normalizedStorageKey) throw new Error("Normalized recording missing");
      const raw = await streamProcessingRequest("transcribe", await resolveStorageKey(refreshed.normalizedStorageKey), signal, stageAttemptId);
      const timeline = parseTranscriptionTimeline(raw);
      if (refreshed.durationMs && Math.abs(timeline.durationMs - Number(refreshed.durationMs)) > 1_000) {
        throw new Error("Normalized audio timeline differs from the recording timeline");
      }
      const segments = assembleWhisperCppResponse(raw);
      const storageKey = newStorageKey("artifact", "json");
      await writeJsonArtifact(storageKey, raw);
      try {
        await db.rawTranscriptionArtifact.create({ data: { meetingId: job.meetingId, stageAttemptId, storageKey, modelName: String(raw.model ?? "unknown"), backend: String(raw.backend ?? "unknown") } });
      } catch (error) { await removeStorageKey(storageKey); throw error; }
      return { storageKey, model: raw.model, backend: raw.backend, segmentCount: segments.length };
    });
    await runStage(job.id, "speaker_diarization", async (stageAttemptId, signal) => {
      const refreshed = await db.recording.findUniqueOrThrow({ where: { id: recording.id } });
      if (!refreshed.normalizedStorageKey) throw new Error("Normalized recording missing");
      if (reprocessing) {
        const prior = await db.rawDiarizationArtifact.findFirst({ where: { meetingId: job.meetingId }, orderBy: { createdAt: "desc" } });
        if (prior) {
          try {
            const raw = JSON.parse(await readFile(await resolveStorageKey(prior.storageKey), "utf8")) as unknown;
            const parsed = parseDiarization(raw);
            return { storageKey: prior.storageKey, reused: true, turnCount: parsed.turns.length, exclusiveTurnCount: parsed.exclusive_turns.length };
          } catch { /* Re-run diarization when its immutable artifact is unavailable or malformed. */ }
        }
      }
      const raw = await streamProcessingRequest("diarize", await resolveStorageKey(refreshed.normalizedStorageKey), signal, stageAttemptId);
      parseDiarization(raw);
      const storageKey = newStorageKey("artifact", "json");
      await writeJsonArtifact(storageKey, raw);
      try {
        await db.rawDiarizationArtifact.create({ data: { meetingId: job.meetingId, stageAttemptId, storageKey, modelName: String(raw.model ?? "unknown") } });
      } catch (error) { await removeStorageKey(storageKey); throw error; }
      return { storageKey, turnCount: Array.isArray(raw.turns) ? raw.turns.length : 0, exclusiveTurnCount: Array.isArray(raw.exclusive_turns) ? raw.exclusive_turns.length : 0 };
    });
    await runStage(job.id, "transcript_alignment", async () => {
      const [transcriptionArtifact, diarizationArtifact] = await Promise.all([
        db.rawTranscriptionArtifact.findFirstOrThrow({ where: { meetingId: job.meetingId }, orderBy: { createdAt: "desc" } }),
        db.rawDiarizationArtifact.findFirstOrThrow({ where: { meetingId: job.meetingId }, orderBy: { createdAt: "desc" } }),
      ]);
      const transcriptionRaw = JSON.parse(await readFile(await resolveStorageKey(transcriptionArtifact.storageKey), "utf8")) as unknown;
      const diarizationRaw = JSON.parse(await readFile(await resolveStorageKey(diarizationArtifact.storageKey), "utf8")) as unknown;
      const aligned = alignWordsToSpeakers(extractWhisperWords(transcriptionRaw), diarizationRaw);
      const speakerKeys = [...new Set(aligned.flatMap((segment) => segment.speakerKey ? [segment.speakerKey] : []))].sort();
      const artifactStage = await db.processingStageAttempt.findUnique({ where: { id: diarizationArtifact.stageAttemptId }, select: { jobId: true } });
      const version = await db.$transaction(async (tx) => {
        const latest = await tx.transcriptVersion.aggregate({ where: { meetingId: job.meetingId }, _max: { version: true } });
        const created = await tx.transcriptVersion.create({ data: { meetingId: job.meetingId, version: (latest._max.version ?? 0) + 1, source: "MACHINE", parentId: reprocessing ? job.targetTranscriptVersionId : null } });
        const speakers = new Map<string, string>();
        for (const [index, key] of speakerKeys.entries()) {
          const diarizationKey = reprocessing && artifactStage?.jobId === job.id ? `${diarizationArtifact.id}:${key}` : key;
          const speaker = await tx.speaker.upsert({ where: { meetingId_diarizationKey: { meetingId: job.meetingId, diarizationKey } }, update: {}, create: { meetingId: job.meetingId, diarizationKey, displayName: `Speaker ${index + 1}` } });
          speakers.set(key, speaker.id);
        }
        await tx.transcriptSegment.createMany({ data: aligned.map(({ speakerKey, ...segment }) => ({ ...segment, speakerId: speakerKey ? speakers.get(speakerKey) : undefined, transcriptVersionId: created.id })) });
        return created;
      });
      return { transcriptVersionId: version.id, segmentCount: aligned.length, speakerCount: speakerKeys.length, unassignedCount: aligned.filter((segment) => !segment.speakerKey).length };
    });
    const transcriptVersionId = await completedAlignmentTranscriptVersionId(job.id);
    await runStage(job.id, "transcript_assembly", async () => {
      const count = await db.transcriptSegment.count({ where: { transcriptVersionId } });
      if (!count) throw new Error("Aligned transcript is empty");
      return { segmentCount: count };
    });
    const summaryVersionId = await runSummaryPipeline(job.id, job.meetingId, transcriptVersionId, { activate: false });
    await runStage(job.id, "completion", async () => {
      await db.$transaction([
        db.processingJob.update({ where: { id: job.id }, data: { state: "COMPLETED", activeStage: null } }),
        db.meeting.update({ where: { id: job.meetingId }, data: { state: "COMPLETED", activeStage: null, activeTranscriptVersionId: transcriptVersionId, activeSummaryVersionId: summaryVersionId } }),
      ]);
      return { saved: true, transcriptVersionId, summaryVersionId, reprocessed: reprocessing };
    });
    return;
  } else {
    for (const stage of PIPELINE_STAGES.slice(3, -1)) await runStage(job.id, stage, async () => ({ simulated: true, warning: "No AI output generated in milestone 1" }));
  }
  await runStage(job.id, "completion", async () => {
    await db.$transaction([db.processingJob.update({ where: { id: job.id }, data: { state: "COMPLETED", activeStage: null } }), db.meeting.update({ where: { id: job.meetingId }, data: { state: "COMPLETED", activeStage: null } })]);
    return { saved: true };
  });
}, { connection: redisConnection(), concurrency: 1, lockDuration: 120_000, stalledInterval: 30_000, maxStalledCount: 2 }).on("failed", async (bullJob, error) => {
  if (!bullJob) return;
  if (error.message === "JOB_CANCELLED") return;
  const retrying = bullJob.attemptsMade < (bullJob.opts.attempts ?? 1);
  const job = await db.processingJob.findUniqueOrThrow({ where: { id: bullJob.data.jobId }, select: { meetingId: true } });
  await db.$transaction([
    db.processingJob.update({ where: { id: bullJob.data.jobId }, data: { state: retrying ? "RETRYING" : "FAILED", errorMessage: error.message.slice(0, 2000), heartbeatAt: new Date() } }),
    db.meeting.update({ where: { id: job.meetingId }, data: { state: retrying ? "PROCESSING" : "FAILED" } }),
  ]);
  await publishProcessingUpdate(job.meetingId);
  logger.error({ event: "job_failed", jobId: bullJob.data.jobId, meetingId: job.meetingId, retrying, attempt: bullJob.attemptsMade, error: error.message.slice(0, 500) });
});

async function completedAlignmentTranscriptVersionId(jobId: string): Promise<string> {
  const stage = await db.processingStageAttempt.findFirstOrThrow({
    where: { jobId, stage: "transcript_alignment", state: "COMPLETED" },
    orderBy: { attempt: "desc" },
    select: { result: true },
  });
  const transcriptVersionId = stage.result && typeof stage.result === "object" && !Array.isArray(stage.result)
    ? (stage.result as Record<string, unknown>).transcriptVersionId
    : undefined;
  if (typeof transcriptVersionId !== "string") throw new Error("Alignment stage did not record a transcript version");
  return transcriptVersionId;
}
