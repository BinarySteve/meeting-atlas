import { argon2id, hash, verify } from "argon2";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password-policy";

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password-policy";

const COMMON_PASSWORDS = new Set([
  "123456789012345",
  "1234567890123456",
  "111111111111111",
  "aaaaaaaaaaaaaaa",
  "adminadminadmin",
  "changemechangeme",
  "correcthorsebatterystaple",
  "iloveyouiloveyou",
  "letmeinletmeinletmein",
  "meetingatlas",
  "meetingatlas123",
  "meetingatlas2026",
  "passwordpassword",
  "passwordpassword1",
  "password123456789",
  "qwertyqwertyqwerty",
  "thisisapassword",
  "welcome123456789",
  "welcomecomewelcome",
  "youllneverguess",
]);

const HASH_OPTIONS = {
  type: argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
} as const;

export function normalizePassword(password: string): string {
  return password.normalize("NFC");
}

export function validateNewPassword(
  password: string,
  context: string[] = [],
): { password?: string; error?: string } {
  const normalized = normalizePassword(password);
  const length = Array.from(normalized).length;
  if (length < PASSWORD_MIN_LENGTH)
    return { error: `Use at least ${PASSWORD_MIN_LENGTH} characters.` };
  if (length > PASSWORD_MAX_LENGTH)
    return { error: `Use no more than ${PASSWORD_MAX_LENGTH} characters.` };

  const canonical = canonicalize(normalized);
  if (COMMON_PASSWORDS.has(canonical) || /^(.)\1{14,}$/.test(canonical))
    return { error: "Choose a less common password or passphrase." };
  for (const value of ["meeting atlas", "meetingatlas", ...context]) {
    const contextual = canonicalize(value);
    if (
      contextual.length >= 4 &&
      (canonical === contextual ||
        (canonical.startsWith(contextual) &&
          canonical.length - contextual.length <= 8) ||
        (canonical.endsWith(contextual) &&
          canonical.length - contextual.length <= 8))
    )
      return {
        error:
          "Password must not be based on your name, email, or the app name.",
      };
  }
  return { password: normalized };
}

export async function hashPassword(password: string): Promise<string> {
  return hash(normalizePassword(password), HASH_OPTIONS);
}

export async function verifyPasswordHash(
  passwordHash: string,
  candidate: string,
): Promise<boolean> {
  if (await verify(passwordHash, candidate).catch(() => false)) return true;
  const normalized = normalizePassword(candidate);
  return (
    normalized !== candidate &&
    (await verify(passwordHash, normalized).catch(() => false))
  );
}

function canonicalize(value: string): string {
  return normalizePassword(value)
    .toLocaleLowerCase("en-US")
    .replaceAll(/[^\p{L}\p{N}]/gu, "");
}
