import { db } from "./db";
import { getEnv } from "./env";

const DATA_LIFECYCLE_LOCK_ID = 6_084_191_237;

export async function withDataLifecycleLock<T>(operation: () => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${DATA_LIFECYCLE_LOCK_ID})`;
    return operation();
  }, { maxWait: 30_000, timeout: getEnv().SUBPROCESS_TIMEOUT_MS });
}
