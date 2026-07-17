import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { db } from "./db";
import { getEnv } from "./env";

const COOKIE = "meeting_session";
const SESSION_SECONDS = 43_200;
export const SESSION_IDLE_SECONDS = 7_200;
const TOUCH_INTERVAL_MS = 5 * 60_000;
const key = () => new TextEncoder().encode(getEnv().SESSION_SECRET);

export type SessionAuthMethod = "PASSWORD" | "PASSKEY" | "UNKNOWN";
export type AuthenticatedSession = { userId: string; sessionId: string; authMethod: SessionAuthMethod; deviceLabel: string | null };

export async function createSession(userId: string, input: { authMethod?: SessionAuthMethod; userAgent?: string | null; deviceLabel?: string | null } = {}): Promise<void> {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
  await db.session.create({ data: { id, userId, expiresAt, authMethod: input.authMethod ?? "UNKNOWN", deviceLabel: input.deviceLabel ?? describeUserAgent(input.userAgent) } });
  const token = await issueSessionToken(userId, id);
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_SECONDS, priority: "high" });
}

export async function clearSession(): Promise<AuthenticatedSession | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  let current: AuthenticatedSession | null = null;
  if (token) {
    const payload = await verifyTokenPayload(token).catch(() => null);
    if (payload?.jti && payload.sub) {
      const session = await db.session.findUnique({ where: { id: payload.jti }, select: { userId: true, authMethod: true, deviceLabel: true } });
      if (session?.userId === payload.sub) current = { userId: session.userId, sessionId: payload.jti, authMethod: toAuthMethod(session.authMethod), deviceLabel: session.deviceLabel };
      await db.session.updateMany({ where: { id: payload.jti }, data: { revokedAt: new Date() } });
    }
  }
  store.delete(COOKIE);
  return current;
}

export async function revokeOtherSessions(userId: string): Promise<number> {
  const token = (await cookies()).get(COOKIE)?.value;
  const current = token ? await verifyTokenPayload(token).catch(() => null) : null;
  const result = await db.session.updateMany({ where: { userId, revokedAt: null, ...(current?.jti ? { id: { not: current.jti } } : {}) }, data: { revokedAt: new Date() } });
  return result.count;
}

export async function revokeAllSessions(userId: string): Promise<number> {
  const result = await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  (await cookies()).delete(COOKIE);
  return result.count;
}

export async function rotateSession(session: AuthenticatedSession): Promise<void> {
  await db.session.updateMany({ where: { id: session.sessionId, userId: session.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await createSession(session.userId, { authMethod: session.authMethod, deviceLabel: session.deviceLabel });
}

export async function issueSessionToken(userId: string, sessionId: string = randomUUID()): Promise<string> {
  return new SignJWT({ sub: userId, ver: 2 }).setProtectedHeader({ alg: "HS256" }).setJti(sessionId).setIssuedAt().setExpirationTime("12h").sign(key());
}

async function verifyTokenPayload(token: string) {
  return (await jwtVerify(token, key(), { algorithms: ["HS256"] })).payload;
}

export async function verifySessionToken(token: string): Promise<string> {
  const payload = await verifyTokenPayload(token);
  if (!payload.sub) throw new Error("UNAUTHORIZED");
  return payload.sub;
}

export async function requireSession(): Promise<AuthenticatedSession> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) throw new Error("UNAUTHORIZED");
  const payload = await verifyTokenPayload(token);
  if (!payload.sub || !payload.jti || payload.ver !== 2) throw new Error("UNAUTHORIZED");
  const now = new Date();
  const session = await db.session.findFirst({ where: { id: payload.jti, userId: payload.sub, revokedAt: null, expiresAt: { gt: now }, lastSeenAt: { gt: new Date(now.getTime() - SESSION_IDLE_SECONDS * 1000) } }, select: { userId: true, authMethod: true, deviceLabel: true, lastSeenAt: true } });
  if (!session) throw new Error("UNAUTHORIZED");
  if (now.getTime() - session.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) await db.session.updateMany({ where: { id: payload.jti, revokedAt: null }, data: { lastSeenAt: now } });
  return { userId: session.userId, sessionId: payload.jti, authMethod: toAuthMethod(session.authMethod), deviceLabel: session.deviceLabel };
}

export async function requireUserId(): Promise<string> {
  return (await requireSession()).userId;
}

export function describeUserAgent(value?: string | null): string | null {
  if (!value) return null;
  const browser = value.includes("Edg/") ? "Edge" : value.includes("Firefox/") ? "Firefox" : value.includes("Chrome/") ? "Chrome" : value.includes("Safari/") ? "Safari" : "Browser";
  const device = /iPhone|iPad/.test(value) ? "iPhone or iPad" : value.includes("Android") ? "Android" : value.includes("Windows") ? "Windows" : value.includes("Mac OS") ? "macOS" : value.includes("Linux") ? "Linux" : "unknown device";
  return `${browser} on ${device}`;
}

function toAuthMethod(value: string): SessionAuthMethod {
  return value === "PASSWORD" || value === "PASSKEY" ? value : "UNKNOWN";
}
