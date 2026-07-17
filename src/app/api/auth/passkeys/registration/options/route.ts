import { generateRegistrationOptions } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureWebAuthnUserId, getWebAuthnConfig, rememberChallenge } from "@/lib/passkeys";

export async function POST() {
  try {
    const userId = await requireUserId();
    const [user, passkeys, webauthnUserId] = await Promise.all([db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } }), db.passkey.findMany({ where: { userId }, select: { credentialId: true, transports: true } }), ensureWebAuthnUserId(userId)]);
    const config = getWebAuthnConfig();
    const options = await generateRegistrationOptions({ rpName: config.rpName, rpID: config.rpID, userName: user.email, userDisplayName: "Meeting workspace owner", userID: Buffer.from(webauthnUserId, "base64url"), attestationType: "none", excludeCredentials: passkeys.map((key) => ({ id: key.credentialId, transports: key.transports as never[] })), authenticatorSelection: { residentKey: "required", userVerification: "required" } });
    await rememberChallenge(options.challenge, "REGISTRATION", userId);
    return NextResponse.json(options, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
}
