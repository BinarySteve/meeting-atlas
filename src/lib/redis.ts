import IORedis from "ioredis";
import { getEnv } from "./env";

const globalForRedis = globalThis as unknown as { redis?: IORedis };
export const redis = globalForRedis.redis ?? new IORedis(getEnv().REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
redis.on("error", () => { /* Health endpoint reports bounded failure; avoid secret-bearing driver dumps. */ });
if (process.env.NODE_ENV !== "production") globalForRedis.redis = redis;
