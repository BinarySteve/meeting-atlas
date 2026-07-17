import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { cp, mkdir, readFile, readdir, realpath, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "./env";
import { withDataLifecycleLock } from "./data-lifecycle";

const BACKUP_NAME = /^meeting-atlas-manual-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.tar\.gz$/;
const MANIFEST_VERSION = 1;

export type BackupSummary = { name: string; createdAt: string; size: number };
type ManifestFile = { path: string; size: number; sha256: string };
type BackupManifest = { formatVersion: number; createdAt: string; database: ManifestFile; storage: ManifestFile[] };

export async function listBackups(): Promise<BackupSummary[]> {
  const root = await backupRoot();
  const entries = await readdir(root, { withFileTypes: true });
  const items = await Promise.all(entries.filter((entry) => entry.isFile() && BACKUP_NAME.test(entry.name)).map(async (entry) => {
    const info = await stat(path.join(root, entry.name));
    return { name: entry.name, createdAt: info.mtime.toISOString(), size: info.size };
  }));
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createBackup(): Promise<BackupSummary> {
  return withDataLifecycleLock(async () => {
    const root = await backupRoot();
    const createdAt = new Date().toISOString();
    const name = `meeting-atlas-manual-${createdAt.replaceAll(":", "-").replace(".", "-")}.tar.gz`;
    const target = await resolveBackupArchive(name);
    const working = path.join(root, `.creating-${randomUUID()}`);
    await mkdir(working, { mode: 0o700 });
    try {
      const databasePath = path.join(working, "database.dump");
      await dumpDatabase(databasePath);
      const storagePath = path.join(working, "storage");
      await cp(path.resolve(getEnv().STORAGE_ROOT), storagePath, { recursive: true, force: false, errorOnExist: true });
      const manifest: BackupManifest = {
        formatVersion: MANIFEST_VERSION,
        createdAt,
        database: await describeFile(databasePath, "database.dump"),
        storage: await describeTree(storagePath),
      };
      await writeFile(path.join(working, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: "wx" });
      await run(getEnv().TAR_PATH, ["-czf", target, "database.dump", "storage", "manifest.json"], { cwd: working });
      const info = await stat(target);
      return { name, createdAt, size: info.size };
    } catch (error) {
      await unlink(target).catch(() => undefined);
      throw error;
    } finally {
      await safeRemoveWorkingDirectory(root, working);
    }
  });
}

export async function verifyBackup(name: string): Promise<{ valid: true; files: number; bytes: number }> {
  const root = await backupRoot();
  const archive = await resolveBackupArchive(name);
  const working = path.join(root, `.verifying-${randomUUID()}`);
  await mkdir(working, { mode: 0o700 });
  try {
    const listing = await run(getEnv().TAR_PATH, ["-tzf", archive]);
    const entries = listing.split(/\r?\n/).filter(Boolean).map((entry) => entry.replace(/^\.\//, ""));
    if (!entries.length || entries.some((entry) => path.isAbsolute(entry) || entry.split("/").includes("..") || !(entry === "database.dump" || entry === "manifest.json" || entry === "storage" || entry.startsWith("storage/")))) throw new Error("Backup contains unsafe or unexpected paths");
    await run(getEnv().TAR_PATH, ["-xzf", archive, "-C", working]);
    const manifest = JSON.parse(await readFile(path.join(working, "manifest.json"), "utf8")) as BackupManifest;
    if (manifest.formatVersion !== MANIFEST_VERSION || !Array.isArray(manifest.storage)) throw new Error("Unsupported backup manifest");
    await assertFile(manifest.database, path.join(working, "database.dump"), "database.dump");
    for (const file of manifest.storage) await assertFile(file, path.join(working, "storage", ...file.path.split("/")), file.path);
    await run(getEnv().PG_RESTORE_PATH, ["--list", path.join(working, "database.dump")]);
    return { valid: true, files: manifest.storage.length + 1, bytes: manifest.database.size + manifest.storage.reduce((total, file) => total + file.size, 0) };
  } finally {
    await safeRemoveWorkingDirectory(root, working);
  }
}

export async function deleteBackup(name: string): Promise<void> {
  await unlink(await resolveBackupArchive(name));
}

export async function getBackupDownload(name: string) {
  const filePath = await resolveBackupArchive(name);
  const info = await stat(filePath);
  return { stream: createReadStream(filePath), size: info.size };
}

export async function resolveBackupArchive(name: string): Promise<string> {
  if (!BACKUP_NAME.test(name) || path.basename(name) !== name) throw new Error("Invalid backup name");
  const root = await backupRoot();
  const target = path.resolve(root, name);
  if (path.dirname(target) !== root) throw new Error("Backup path escaped root");
  return target;
}

async function backupRoot() {
  const root = path.resolve(getEnv().BACKUP_ROOT);
  await mkdir(root, { recursive: true, mode: 0o700 });
  return realpath(root);
}

async function dumpDatabase(output: string) {
  const database = new URL(getEnv().DATABASE_URL);
  await run(getEnv().PG_DUMP_PATH, ["--format=custom", "--no-owner", "--no-privileges", "--file", output], { env: {
    PGHOST: database.hostname,
    PGPORT: database.port || "5432",
    PGUSER: decodeURIComponent(database.username),
    PGPASSWORD: decodeURIComponent(database.password),
    PGDATABASE: database.pathname.replace(/^\//, ""),
  } });
}

async function describeTree(root: string): Promise<ManifestFile[]> {
  const output: ManifestFile[] = [];
  async function walk(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) output.push(await describeFile(absolute, path.relative(root, absolute).split(path.sep).join("/")));
      else throw new Error("Storage contains unsupported filesystem entry");
    }
  }
  await walk(root);
  return output.sort((a, b) => a.path.localeCompare(b.path));
}

async function describeFile(filePath: string, relativePath: string): Promise<ManifestFile> {
  const hash = createHash("sha256");
  const info = await stat(filePath);
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return { path: relativePath, size: info.size, sha256: hash.digest("hex") };
}

async function assertFile(expected: ManifestFile, filePath: string, expectedPath: string) {
  if (expected.path !== expectedPath || expected.path.split("/").includes("..") || path.isAbsolute(expected.path)) throw new Error("Backup manifest contains unsafe path");
  const actual = await describeFile(filePath, expectedPath);
  if (actual.size !== expected.size || actual.sha256 !== expected.sha256) throw new Error(`Backup checksum failed for ${expectedPath}`);
}

async function run(command: string, args: string[], options: { cwd?: string; env?: Record<string, string> } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: { ...process.env, ...options.env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { if (stdout.length < 1_000_000) stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < 4_096) stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`${path.basename(command)} failed with exit code ${code}${stderr ? `: ${stderr.trim()}` : ""}`)));
  });
}

async function safeRemoveWorkingDirectory(root: string, working: string) {
  const relative = path.relative(root, path.resolve(working));
  if (!relative.startsWith(".creating-") && !relative.startsWith(".verifying-")) throw new Error("Refused unsafe backup cleanup");
  await rm(working, { recursive: true, force: true });
}
