import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { db } from "../src/lib/db";

async function main(): Promise<void> {
  const queueName = `meeting-integration-${randomUUID()}`;
  const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  const queue = new Queue<{ jobId: string }>(queueName, { connection: { host: redisUrl.hostname, port: Number(redisUrl.port || 6379), username: redisUrl.username || undefined, password: redisUrl.password || undefined } });
  const meeting = await db.meeting.create({ data: { title: `Integration ${randomUUID()}` } });
  try {
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
  } finally {
    await db.meeting.delete({ where: { id: meeting.id } });
    await queue.obliterate({ force: true });
    await queue.close();
    await db.$disconnect();
  }
  console.log("Database transaction guards and Redis queue integration passed");
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Integration test failed"); process.exitCode = 1; });
