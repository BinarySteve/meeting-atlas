import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  assertExpectedOrigin,
  consumeChallenge,
  getWebAuthnConfig,
} from "@/lib/passkeys";
import {
  authRateKey,
  clearAuthFailures,
  isAuthBlocked,
  recordAuthFailure,
} from "@/lib/auth-rate-limit";
import { writeAudit } from "@/lib/audit";

export async function POST(request: Request) {
  if (!assertExpectedOrigin(request))
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  const response = (await request
    .json()
    .catch(() => null)) as AuthenticationResponseJSON | null;
  if (!response?.id)
    return NextResponse.json(
      { error: "Invalid passkey response" },
      { status: 400 },
    );
  const rateKey = authRateKey("passkey", response.id);
  if (await isAuthBlocked(rateKey))
    return NextResponse.json(
      { error: "Passkey sign-in failed" },
      { status: 429 },
    );
  try {
    const challenge = await consumeChallenge("AUTHENTICATION");
    const passkey = await db.passkey.findUnique({
      where: { credentialId: response.id },
    });
    if (!passkey) {
      await recordAuthFailure(rateKey);
      return NextResponse.json(
        { error: "Passkey sign-in failed" },
        { status: 401 },
      );
    }
    const config = getWebAuthnConfig();
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: Number(passkey.counter),
        transports: passkey.transports as AuthenticatorTransportFuture[],
      },
    });
    if (!verification.verified) {
      await recordAuthFailure(rateKey);
      return NextResponse.json(
        { error: "Passkey sign-in failed" },
        { status: 401 },
      );
    }
    await clearAuthFailures(rateKey);
    await db.passkey.update({
      where: { id: passkey.id },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      },
    });
    await createSession(passkey.userId, {
      authMethod: "PASSKEY",
      userAgent: request.headers.get("user-agent"),
    });
    await writeAudit(db, {
      userId: passkey.userId,
      action: "PASSKEY_LOGIN",
      entityType: "Passkey",
      entityId: passkey.id,
    });
    return NextResponse.json({ ok: true });
  } catch {
    await recordAuthFailure(rateKey);
    return NextResponse.json(
      { error: "Passkey sign-in failed or expired" },
      { status: 401 },
    );
  }
}
