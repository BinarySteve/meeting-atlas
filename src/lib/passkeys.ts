import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";
import { getEnv } from "./env";

export const CHALLENGE_COOKIE = "webauthn_challenge";
export const CHALLENGE_MAX_AGE = 300;

export function getWebAuthnConfig() {
  const env = getEnv();
  const origin = new URL(env.WEBAUTHN_ORIGIN);
  const local = env.WEBAUTHN_RP_ID === "localhost" && origin.hostname === "localhost";
  if (process.env.NODE_ENV === "production" && !local && origin.protocol !== "https:") throw new Error("WEBAUTHN_ORIGIN must use HTTPS outside localhost");
  if (origin.hostname !== env.WEBAUTHN_RP_ID && !origin.hostname.endsWith(`.${env.WEBAUTHN_RP_ID}`)) throw new Error("WEBAUTHN_RP_ID must equal or be a parent domain of WEBAUTHN_ORIGIN");
  if (origin.pathname !== "/" || origin.search || origin.hash) throw new Error("WEBAUTHN_ORIGIN must not include a path, query, or fragment");
  return { rpID: env.WEBAUTHN_RP_ID, rpName: env.WEBAUTHN_RP_NAME, origin: origin.origin };
}

export function assertExpectedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === getWebAuthnConfig().origin;
}

export async function ensureWebAuthnUserId(userId: string): Promise<string> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { webauthnUserId: true } });
  if (user.webauthnUserId) return user.webauthnUserId;
  const value = randomBytes(32).toString("base64url");
  await db.user.update({ where: { id: userId }, data: { webauthnUserId: value } });
  return value;
}

export async function rememberChallenge(challenge: string, operation: "REGISTRATION" | "AUTHENTICATION", userId?: string) {
  await db.webAuthnChallenge.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }] } });
  const row = await db.webAuthnChallenge.create({ data: { challenge, operation, userId, expiresAt: new Date(Date.now() + CHALLENGE_MAX_AGE * 1000) } });
  (await cookies()).set(CHALLENGE_COOKIE, row.id, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/api/auth/passkeys", maxAge: CHALLENGE_MAX_AGE, priority: "high" });
}

export async function consumeChallenge(operation: "REGISTRATION" | "AUTHENTICATION", userId?: string) {
  const store = await cookies();
  const id = store.get(CHALLENGE_COOKIE)?.value;
  store.delete(CHALLENGE_COOKIE);
  if (!id) throw new Error("Passkey request expired. Try again.");
  const challenge = await db.webAuthnChallenge.findFirst({ where: { id, operation, userId: userId ?? null, usedAt: null, expiresAt: { gt: new Date() } } });
  if (!challenge) throw new Error("Passkey request expired or was already used.");
  const consumed = await db.webAuthnChallenge.updateMany({ where: { id, usedAt: null }, data: { usedAt: new Date() } });
  if (consumed.count !== 1) throw new Error("Passkey request was already used.");
  return challenge.challenge;
}
