import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveStorageKey } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: RouteContext<"/api/meetings/[id]/recording">) {
  try { await requireUserId(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const { id } = await context.params;
  const recording = await db.recording.findFirst({ where: { meetingId: id }, orderBy: { createdAt: "asc" } });
  if (!recording) return NextResponse.json({ error: "Recording not found" }, { status: 404 });
  const playback = new URL(request.url).searchParams.get("variant") === "playback";
  if (playback && !recording.normalizedStorageKey) return NextResponse.json({ error: "Playback audio is not ready" }, { status: 404 });
  const filePath = await resolveStorageKey(playback ? recording.normalizedStorageKey! : recording.storageKey);
  const file = await stat(filePath).catch(() => null);
  if (!file?.isFile()) return NextResponse.json({ error: "Recording file unavailable" }, { status: 404 });
  const range = request.headers.get("range");
  const headers = new Headers({
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
    "content-type": playback ? "audio/wav" : mediaType(recording.originalFilename),
    "x-content-type-options": "nosniff",
  });
  if (!range) {
    headers.set("content-length", String(file.size));
    return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream, { headers });
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) return new Response(null, { status: 416, headers: { "content-range": `bytes */${file.size}` } });
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : file.size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= file.size) {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${file.size}` } });
  }
  headers.set("content-length", String(end - start + 1));
  headers.set("content-range", `bytes ${start}-${end}/${file.size}`);
  return new Response(Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream, { status: 206, headers });
}

function mediaType(filename: string): string {
  const extension = filename.toLowerCase().split(".").at(-1);
  return ({ mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg", webm: "video/webm", mp4: "video/mp4" } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
}
