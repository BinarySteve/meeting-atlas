import { createWriteStream } from "node:fs";
import { mkdir, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getEnv } from "./env";

export function newStorageKey(kind: "original" | "normalized" | "artifact", extension = "bin"): string {
  const safeExt = extension.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) || "bin";
  return `${kind}/${new Date().getUTCFullYear()}/${randomUUID()}.${safeExt}`;
}

export async function resolveStorageKey(key: string): Promise<string> {
  if (!/^[a-z0-9/_-]+\.[a-z0-9]+$/i.test(key) || key.includes("..") || path.isAbsolute(key)) {
    throw new Error("Unsafe storage key");
  }
  const root = path.resolve(getEnv().STORAGE_ROOT);
  const target = path.resolve(root, ...key.split("/"));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("Storage path escaped root");
  await mkdir(path.dirname(target), { recursive: true });
  const canonicalRoot = await realpath(root).catch(async () => { await mkdir(root, { recursive: true }); return realpath(root); });
  const canonicalTarget = path.resolve(canonicalRoot, ...key.split("/"));
  const relative = path.relative(canonicalRoot, canonicalTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Storage path escaped canonical root");
  return canonicalTarget;
}

export async function createStorageWriteStream(key: string) {
  return createWriteStream(await resolveStorageKey(key), { flags: "wx", mode: 0o600 });
}

export async function writeJsonArtifact(key: string, value: unknown): Promise<void> {
  await writeFile(await resolveStorageKey(key), JSON.stringify(value), { encoding: "utf8", flag: "wx", mode: 0o600 });
}

export async function writeTextArtifact(key: string, value: string): Promise<void> {
  await writeFile(await resolveStorageKey(key), value, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

export async function removeStorageKey(key: string): Promise<void> {
  await unlink(await resolveStorageKey(key)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}
