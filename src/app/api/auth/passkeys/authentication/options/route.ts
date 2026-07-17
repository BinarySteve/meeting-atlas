import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { getWebAuthnConfig, rememberChallenge } from "@/lib/passkeys";

export async function POST() {
  const { rpID } = getWebAuthnConfig();
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required", allowCredentials: [] });
  await rememberChallenge(options.challenge, "AUTHENTICATION");
  return NextResponse.json(options, { headers: { "Cache-Control": "no-store" } });
}
