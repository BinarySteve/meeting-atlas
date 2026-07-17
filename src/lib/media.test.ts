import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inspectMedia, normalizeMedia } from "./media";

let directory = "";
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "meeting-media-"));
  process.env.FFPROBE_PATH = "ffprobe";
  process.env.FFMPEG_PATH = "ffmpeg";
  process.env.SUBPROCESS_TIMEOUT_MS = "10000";
  process.env.DATABASE_URL = "postgresql://x:x@localhost/x";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.STORAGE_ROOT = directory;
  process.env.SESSION_SECRET = "01234567890123456789012345678901";
  process.env.PROCESSING_API_URL = "http://127.0.0.1:8080";
  process.env.PROCESSING_API_CREDENTIAL = "01234567890123456789012345678901";
});
afterEach(() => rm(directory, { recursive: true, force: true }));

describe("media inspection and cancellation", () => {
  it("detects audio from content instead of extension", async () => {
    const input = path.join(directory, "deceptive.bin");
    await writeFile(input, wavFixture());
    const info = await inspectMedia(input);
    expect(info.format).toContain("wav");
    expect(info.sampleRate).toBe(16_000);
    expect(info.channels).toBe(1);
  });

  it("cancels active normalization", async () => {
    const input = path.join(directory, "input.wav");
    await writeFile(input, wavFixture());
    const controller = new AbortController();
    controller.abort();
    await expect(normalizeMedia(input, path.join(directory, "output.wav"), controller.signal)).rejects.toThrow("JOB_CANCELLED");
  });
});

function wavFixture(): Buffer {
  const samples = 1_600;
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + dataSize, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16_000, 24); buffer.writeUInt32LE(32_000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}
