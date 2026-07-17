import { authRateKey, clearAuthFailures, isAuthBlocked, recordAuthFailure } from "./auth-rate-limit";
import { db } from "./db";
import { verifyPasswordHash } from "./passwords";

export type ReauthenticationResult = "valid" | "invalid" | "blocked";

export async function authenticateCurrentPassword(userId: string, password: string): Promise<ReauthenticationResult> {
  const rateKey = authRateKey("reauth", userId);
  if (await isAuthBlocked(rateKey)) return "blocked";
  const user = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user || !(await verifyPasswordHash(user.passwordHash, password))) {
    await recordAuthFailure(rateKey);
    return "invalid";
  }
  await clearAuthFailures(rateKey);
  return "valid";
}
