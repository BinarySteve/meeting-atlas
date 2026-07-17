import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { requireUserId, revokeOtherSessions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  assertExpectedOrigin,
  consumeChallenge,
  getWebAuthnConfig,
} from "@/lib/passkeys";
import { authenticateCurrentPassword } from "@/lib/account-security";
import { writeAudit } from "@/lib/audit";

export async function POST(request: Request) {
  if (!assertExpectedOrigin(request))
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  try {
    const userId = await requireUserId();
    const body = (await request.json()) as {
      response?: RegistrationResponseJSON;
      name?: string;
      currentPassword?: string;
    };
    if (!body.response || !body.name?.trim() || !body.currentPassword)
      return NextResponse.json(
        { error: "Device name and current password are required" },
        { status: 400 },
      );
    const passkeyName = body.name.trim().slice(0, 80);
    const reauthentication = await authenticateCurrentPassword(
      userId,
      body.currentPassword,
    );
    if (reauthentication !== "valid")
      return NextResponse.json(
        {
          error:
            reauthentication === "blocked"
              ? "Too many attempts. Try again later."
              : "Current password is incorrect",
        },
        { status: reauthentication === "blocked" ? 429 : 401 },
      );
    const challenge = await consumeChallenge("REGISTRATION", userId);
    const config = getWebAuthnConfig();
    const verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo)
      throw new Error("Verification failed");
    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;
    await db.$transaction(async (tx) => {
      const passkey = await tx.passkey.create({
        data: {
          userId,
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey),
          counter: BigInt(credential.counter),
          transports: credential.transports ?? [],
          deviceType: credentialDeviceType,
          backedUp: credentialBackedUp,
          name: passkeyName,
        },
      });
      await writeAudit(tx, {
        userId,
        action: "PASSKEY_REGISTERED",
        entityType: "Passkey",
        entityId: passkey.id,
      });
    });
    await revokeOtherSessions(userId);
    return NextResponse.json({ verified: true });
  } catch {
    return NextResponse.json(
      { error: "Passkey registration failed or expired" },
      { status: 400 },
    );
  }
}
