import { createHmac } from "node:crypto";
import { db } from "./db";
import { getEnv } from "./env";

const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 8;

export function authRateKey(scope: "password" | "passkey" | "passkey-options" | "reauth", identifier: string): string {
  return createHmac("sha256", getEnv().SESSION_SECRET).update(`${scope}:${identifier.toLocaleLowerCase()}`).digest("hex");
}

export async function isAuthBlocked(key: string): Promise<boolean> {
  const row = await db.authRateLimit.findUnique({ where: { key } });
  return Boolean(row?.blockedUntil && row.blockedUntil > new Date());
}

export async function recordAuthFailure(key: string): Promise<void> {
  const now = new Date();
  await db.$transaction(async (tx) => {
    const row = await tx.authRateLimit.findUnique({ where: { key } });
    const reset = !row || now.getTime() - row.windowStarted.getTime() > WINDOW_MS;
    const attempts = reset ? 1 : row.attempts + 1;
    await tx.authRateLimit.upsert({ where: { key }, create: { key, attempts, windowStarted: now, blockedUntil: attempts >= MAX_ATTEMPTS ? new Date(now.getTime() + WINDOW_MS) : null }, update: { attempts, windowStarted: reset ? now : undefined, blockedUntil: attempts >= MAX_ATTEMPTS ? new Date(now.getTime() + WINDOW_MS) : row?.blockedUntil } });
  });
}

export async function clearAuthFailures(key: string): Promise<void> {
  await db.authRateLimit.deleteMany({ where: { key } });
}
