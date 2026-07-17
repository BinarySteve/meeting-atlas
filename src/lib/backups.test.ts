import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.join(process.cwd(), ".test-backups");

beforeEach(async () => {
  process.env.DATABASE_URL = "postgresql://meeting:test@127.0.0.1:5432/meeting_transcriber";
  process.env.REDIS_URL = "redis://127.0.0.1:6379";
  process.env.STORAGE_ROOT = path.join(process.cwd(), ".test-storage");
  process.env.BACKUP_ROOT = root;
  process.env.SESSION_SECRET = "01234567890123456789012345678901";
  process.env.PROCESSING_API_URL = "http://127.0.0.1:8080";
  process.env.PROCESSING_API_CREDENTIAL = "01234567890123456789012345678901";
  await mkdir(root, { recursive: true });
});

afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("backup filesystem boundary", () => {
  it("rejects traversal and unknown archive names", async () => {
    const { resolveBackupArchive } = await import("./backups");
    await expect(resolveBackupArchive("../database.dump")).rejects.toThrow("Invalid backup name");
    await expect(resolveBackupArchive("meeting-atlas-manual-latest.tar.gz")).rejects.toThrow("Invalid backup name");
  });

  it("lists only generated backup archives", async () => {
    const valid = "meeting-atlas-manual-2026-07-17T12-30-00-000Z.tar.gz";
    await writeFile(path.join(root, valid), "archive");
    await writeFile(path.join(root, "not-a-backup.txt"), "ignore");
    const { listBackups } = await import("./backups");
    await expect(listBackups()).resolves.toEqual([expect.objectContaining({ name: valid, size: 7 })]);
  });
});
