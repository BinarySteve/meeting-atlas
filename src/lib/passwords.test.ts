import { describe, expect, it } from "vitest";
import { hashPassword, validateNewPassword, verifyPasswordHash } from "./passwords";

describe("owner password policy", () => {
  it("requires at least 15 characters and allows long Unicode passphrases", () => {
    expect(validateNewPassword("too short").error).toContain("15");
    expect(validateNewPassword("Mañana has quiet blue clouds ☁️").password).toBe("Mañana has quiet blue clouds ☁️".normalize("NFC"));
  });

  it("rejects common, repeated, and account-derived values", () => {
    expect(validateNewPassword("passwordpassword").error).toMatch(/less common/i);
    expect(validateNewPassword("aaaaaaaaaaaaaaaa").error).toMatch(/less common/i);
    expect(validateNewPassword("alexander-secret", ["Alexander"]).error).toMatch(/name, email/i);
  });

  it("hashes with Argon2id and verifies the normalized password", async () => {
    const password = "Cafe\u0301 owns a very long atlas";
    const passwordHash = await hashPassword(password);
    expect(passwordHash).toMatch(/^\$argon2id\$/);
    await expect(verifyPasswordHash(passwordHash, password.normalize("NFC"))).resolves.toBe(true);
    await expect(verifyPasswordHash(passwordHash, "wrong password value")).resolves.toBe(false);
  });
});
