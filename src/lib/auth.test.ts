import { beforeEach, describe, expect, it } from "vitest";

beforeEach(() => {
  process.env.SESSION_SECRET = "01234567890123456789012345678901";
  process.env.DATABASE_URL = "postgresql://x:x@localhost/x";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.STORAGE_ROOT = ".test-storage";
  process.env.PROCESSING_API_URL = "http://127.0.0.1:8080";
  process.env.PROCESSING_API_CREDENTIAL = "01234567890123456789012345678901";
});

describe("owner session authorization", () => {
  it("accepts signed token and rejects tampering", async () => {
    const { issueSessionToken, verifySessionToken } = await import("./auth");
    const token = await issueSessionToken("owner");
    await expect(verifySessionToken(token)).resolves.toBe("owner");
    const [header, payload, signature] = token.split(".");
    const at = Math.floor(signature.length / 2);
    const tampered = `${header}.${payload}.${signature.slice(0, at)}${signature[at] === "A" ? "B" : "A"}${signature.slice(at + 1)}`;
    await expect(verifySessionToken(tampered)).rejects.toThrow();
  });

  it("creates a privacy-preserving device label", async () => {
    const { describeUserAgent } = await import("./auth");
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/125.0")).toBe("Chrome on Windows");
    expect(describeUserAgent("Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1")).toBe("Safari on iPhone or iPad");
    expect(describeUserAgent(null)).toBeNull();
  });
});
