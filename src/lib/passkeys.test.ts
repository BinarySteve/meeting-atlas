import { beforeEach, describe, expect, it } from "vitest";

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://x:x@localhost/x";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.STORAGE_ROOT = ".test-storage";
  process.env.SESSION_SECRET = "01234567890123456789012345678901";
  process.env.PROCESSING_API_URL = "http://127.0.0.1:8080";
  process.env.PROCESSING_API_CREDENTIAL = "01234567890123456789012345678901";
  process.env.WEBAUTHN_RP_NAME = "Meeting Atlas";
});

describe("passkey relying-party configuration", () => {
  it("accepts localhost development", async () => {
    process.env.WEBAUTHN_RP_ID = "localhost";
    process.env.WEBAUTHN_ORIGIN = "http://localhost:6982";
    const { getWebAuthnConfig } = await import("./passkeys");
    expect(getWebAuthnConfig()).toMatchObject({ rpID: "localhost", origin: "http://localhost:6982" });
  });

  it("rejects an origin outside the RP ID", async () => {
    process.env.WEBAUTHN_RP_ID = "meetings.home.arpa";
    process.env.WEBAUTHN_ORIGIN = "https://evil.example";
    const { getWebAuthnConfig } = await import("./passkeys");
    expect(() => getWebAuthnConfig()).toThrow("WEBAUTHN_RP_ID");
  });
});
