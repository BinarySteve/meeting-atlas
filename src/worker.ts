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
import { assembleWhisperCppResponse } from "./lib/transcription";
import { extractWhisperWords } from "./lib/transcription";
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
  const original = await resolveStorageKey(recording.storageKey);
  await runStage(job.id, "upload_validation", async () => ({ byteSize: recording.byteSize.toString(), sha256: recording.sha256 }));
  await runStage(job.id, "audio_inspection", async (_stageAttemptId, signal) => {
    const info = await inspectMedia(original, signal);
    await db.recording.update({ where: { id: recording.id }, data: { detectedFormat: info.format, durationMs: info.durationMs, sampleRate: info.sampleRate, channels: info.channels, mediaMetadata: info.raw as Prisma.InputJsonValue } });
    return { format: info.format, durationMs: info.durationMs.toString() };
  });
  await runStage(job.id, "audio_normalization", async (_stageAttemptId, signal) => {
    const key = newStorageKey("normalized", "wav");
    try { await normalizeMedia(original, await resolveStorageKey(key), signal); }
    catch (error) { await removeStorageKey(key); throw error; }
    await db.recording.update({ where: { id: recording.id }, data: { normalizedStorageKey: key } });
    return { storageKey: key };
  });
  const env = getEnv();
  if (env.PROCESSING_MODE === "simulation" && (!env.ALLOW_SIMULATION || process.env.NODE_ENV === "production")) throw new Error("Simulation mode forbidden by environment policy");
  if (env.PROCESSING_MODE === "remote") {
    await runStage(job.id, "speech_transcription", async (stageAttemptId, signal) => {
      const refreshed = await db.recording.findUniqueOrThrow({ where: { id: recording.id } });
      if (!refreshed.normalizedStorageKey) throw new Error("Normalized recording missing");
      const raw = await streamProcessingRequest("transcribe", await resolveStorageKey(refreshed.normalizedStorageKey), signal, stageAttemptId);
      const segments = assembleWhisperCppResponse(raw);
      const storageKey = newStorageKey("artifact", "json");
      await writeJsonArtifact(storageKey, raw);
      await db.rawTranscriptionArtifact.create({ data: { meetingId: job.meetingId, stageAttemptId, storageKey, modelName: String(raw.model ?? "unknown"), backend: String(raw.backend ?? "unknown") } });
      await db.$transaction(async (tx) => {
        const version = await tx.transcriptVersion.upsert({
          where: { meetingId_version: { meetingId: job.meetingId, version: 1 } },
          update: { source: "MACHINE" },
          create: { meetingId: job.meetingId, version: 1, source: "MACHINE" },
        });
        await tx.transcriptSegment.deleteMany({ where: { transcriptVersionId: version.id } });
        await tx.transcriptSegment.createMany({ data: segments.map((segment) => ({ ...segment, transcriptVersionId: version.id })) });
      });
      return { storageKey, model: raw.model, backend: raw.backend, segmentCount: segments.length };
    });
    await runStage(job.id, "speaker_diarization", async (stageAttemptId, signal) => {
      const refreshed = await db.recording.findUniqueOrThrow({ where: { id: recording.id } });
      if (!refreshed.normalizedStorageKey) throw new Error("Normalized recording missing");
      const raw = await streamProcessingRequest("diarize", await resolveStorageKey(refreshed.normalizedStorageKey), signal, stageAttemptId);
      parseDiarization(raw);
      const storageKey = newStorageKey("artifact", "json");
      await writeJsonArtifact(storageKey, raw);
      await db.rawDiarizationArtifact.create({ data: { meetingId: job.meetingId, stageAttemptId, storageKey, modelName: String(raw.model ?? "unknown") } });
      return { storageKey, turnCount: Array.isArray(raw.turns) ? raw.turns.length : 0, exclusiveTurnCount: Array.isArray(raw.exclusive_turns) ? raw.exclusive_turns.length : 0 };
    });
    await runStage(job.id, "transcript_alignment", async () => {
      const [transcriptionArtifact, diarizationArtifact, version] = await Promise.all([
        db.rawTranscriptionArtifact.findFirstOrThrow({ where: { meetingId: job.meetingId }, orderBy: { createdAt: "desc" } }),
        db.rawDiarizationArtifact.findFirstOrThrow({ where: { meetingId: job.meetingId }, orderBy: { createdAt: "desc" } }),
        db.transcriptVersion.findUniqueOrThrow({ where: { meetingId_version: { meetingId: job.meetingId, version: 1 } } }),
      ]);
      const transcriptionRaw = JSON.parse(await readFile(await resolveStorageKey(transcriptionArtifact.storageKey), "utf8")) as unknown;
      const diarizationRaw = JSON.parse(await readFile(await resolveStorageKey(diarizationArtifact.storageKey), "utf8")) as unknown;
      const aligned = alignWordsToSpeakers(extractWhisperWords(transcriptionRaw), diarizationRaw);
      const speakerKeys = [...new Set(aligned.flatMap((segment) => segment.speakerKey ? [segment.speakerKey] : []))].sort();
      await db.$transaction(async (tx) => {
        const speakers = new Map<string, string>();
        for (const [index, key] of speakerKeys.entries()) {
          const speaker = await tx.speaker.upsert({ where: { meetingId_diarizationKey: { meetingId: job.meetingId, diarizationKey: key } }, update: {}, create: { meetingId: job.meetingId, diarizationKey: key, displayName: `Speaker ${index + 1}` } });
          speakers.set(key, speaker.id);
        }
        await tx.transcriptSegment.deleteMany({ where: { transcriptVersionId: version.id } });
        await tx.transcriptSegment.createMany({ data: aligned.map(({ speakerKey, ...segment }) => ({ ...segment, speakerId: speakerKey ? speakers.get(speakerKey) : undefined, transcriptVersionId: version.id })) });
      });
      return { segmentCount: aligned.length, speakerCount: speakerKeys.length, unassignedCount: aligned.filter((segment) => !segment.speakerKey).length };
    });
    await runStage(job.id, "transcript_assembly", async () => {
      const count = await db.transcriptSegment.count({ where: { transcriptVersion: { meetingId: job.meetingId, version: 1 } } });
      if (!count) throw new Error("Aligned transcript is empty");
      return { segmentCount: count };
    });
    const transcript = await db.transcriptVersion.findUniqueOrThrow({
      where: { meetingId_version: { meetingId: job.meetingId, version: 1 } },
      select: { id: true },
    });
    await runSummaryPipeline(job.id, job.meetingId, transcript.id);
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
