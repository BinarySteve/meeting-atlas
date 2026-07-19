import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { db } from "../src/lib/db";
import { createEditedTranscriptVersion } from "../src/lib/transcript-editing";

async function main(): Promise<void> {
  const queueName = `meeting-integration-${randomUUID()}`;
  const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  const queue = new Queue<{ jobId: string }>(queueName, { connection: { host: redisUrl.hostname, port: Number(redisUrl.port || 6379), username: redisUrl.username || undefined, password: redisUrl.password || undefined } });
  const meeting = await db.meeting.create({ data: { title: `Integration ${randomUUID()}` } });
  try {
    const owner = await db.user.findFirst({ select: { id: true } });
    assert.ok(owner, "Create owner account before integration test");
    const transcript = await db.transcriptVersion.create({
      data: {
        meetingId: meeting.id,
        version: 1,
        source: "MACHINE",
        segments: { create: { ordinal: 0, startMs: 0, endMs: 1_000, text: "Synthetic segment", sourceSegmentIds: ["synthetic:0"] } },
      },
      include: { segments: true },
    });
    await db.meeting.update({ where: { id: meeting.id }, data: { activeTranscriptVersionId: transcript.id } });
    const processingJob = await db.processingJob.create({ data: { meetingId: meeting.id } });
    await assert.rejects(() => db.processingJob.create({ data: { meetingId: meeting.id, kind: "SUMMARY_REGENERATION" } }));
    const stage = await db.processingStageAttempt.create({ data: { jobId: processingJob.id, stage: "upload_validation", attempt: 1, state: "COMPLETED", idempotencyKey: `${processingJob.id}:upload_validation:1` } });
    await assert.rejects(() => db.processingStageAttempt.create({ data: { jobId: processingJob.id, stage: "upload_validation", attempt: 2, state: "COMPLETED", idempotencyKey: stage.idempotencyKey } }));
    const queued = await queue.add("durability", { jobId: processingJob.id }, { jobId: "stable-run" });
    const duplicate = await queue.add("durability", { jobId: "should-not-replace" }, { jobId: "stable-run" });
    assert.equal(duplicate.id, queued.id);
    assert.equal(await queue.count(), 1);
    const restored = await queue.getJob(queued.id ?? "");
    assert.equal(restored?.data.jobId, processingJob.id);
    await restored?.remove();
    await assert.rejects(() => createEditedTranscriptVersion({
      meetingId: meeting.id,
      baseVersionId: transcript.id,
      userId: owner.id,
      edit: { action: "edit_text", segmentId: transcript.segments[0].id, text: "Protected edit" },
    }), /active processing/);
    await db.processingJob.update({ where: { id: processingJob.id }, data: { state: "COMPLETED" } });
    const edited = await createEditedTranscriptVersion({
      meetingId: meeting.id,
      baseVersionId: transcript.id,
      userId: owner.id,
      edit: { action: "edit_text", segmentId: transcript.segments[0].id, text: "Synthetic correction" },
    });
    const activated = await db.meeting.findUniqueOrThrow({ where: { id: meeting.id }, select: { activeTranscriptVersionId: true } });
    assert.equal(activated.activeTranscriptVersionId, edited.id);
  } finally {
    await db.auditEvent.deleteMany({ where: { meetingId: meeting.id } });
    await db.meeting.delete({ where: { id: meeting.id } });
    await queue.obliterate({ force: true });
    await queue.close();
    await db.$disconnect();
  }
  console.log("Database transaction guards and Redis queue integration passed");
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Integration test failed"); process.exitCode = 1; });
