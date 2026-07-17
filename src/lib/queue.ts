import { Queue } from "bullmq";
import { getEnv } from "./env";

export const PIPELINE_QUEUE = "meeting-pipeline";
export const redisConnection = () => { const url = new URL(getEnv().REDIS_URL); return { host: url.hostname, port: Number(url.port || 6379), username: url.username || undefined, password: url.password || undefined, maxRetriesPerRequest: null }; };
export const pipelineQueue = new Queue<{ jobId: string }, void, "process">(PIPELINE_QUEUE, { connection: redisConnection() });

export async function enqueuePipeline(jobId: string, runRevision = 0): Promise<string> {
  const job = await pipelineQueue.add("process", { jobId }, {
    jobId: `${jobId}-run-${runRevision}`,
    attempts: 5,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  });
  return String(job.id);
}
