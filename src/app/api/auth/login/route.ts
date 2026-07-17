import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { assertExpectedOrigin } from "@/lib/passkeys";
import {
  authRateKey,
  clearAuthFailures,
  isAuthBlocked,
  recordAuthFailure,
} from "@/lib/auth-rate-limit";
import { verifyPasswordHash } from "@/lib/passwords";
import { writeAudit } from "@/lib/audit";
import { PASSWORD_INPUT_MAX_LENGTH } from "@/lib/password-policy";

const inputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(PASSWORD_INPUT_MAX_LENGTH),
});
export async function POST(request: Request) {
  if (request.headers.get("origin") && !assertExpectedOrigin(request))
    return NextResponse.json({ error: "Invalid credentials" }, { status: 403 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid credentials" }, { status: 400 });
  const rateKey = authRateKey("password", parsed.data.email);
  if (await isAuthBlocked(rateKey))
    return NextResponse.json({ error: "Invalid credentials" }, { status: 429 });
  const user = await db.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
  });
  if (
    !user ||
    !(await verifyPasswordHash(user.passwordHash, parsed.data.password))
  ) {
    await recordAuthFailure(rateKey);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  await clearAuthFailures(rateKey);
  await createSession(user.id, {
    authMethod: "PASSWORD",
    userAgent: request.headers.get("user-agent"),
  });
  await writeAudit(db, {
    userId: user.id,
    action: "PASSWORD_LOGIN",
    entityType: "Account",
    entityId: user.id,
  });
  const passkeyCount = await db.passkey.count({ where: { userId: user.id } });
  return NextResponse.json({ ok: true, suggestPasskey: passkeyCount === 0 });
}
