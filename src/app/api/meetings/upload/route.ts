import { createHash } from "node:crypto";
import { extname } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { enqueuePipeline } from "@/lib/queue";
import { createStorageWriteStream, newStorageKey, resolveStorageKey } from "@/lib/storage";
import { publishProcessingUpdate } from "@/lib/processing-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  if (!request.body) return NextResponse.json({ error: "Missing request body" }, { status: 400 });
  const originalFilename = decodeURIComponent(request.headers.get("x-filename") ?? "recording").slice(0, 255);
  const title = decodeURIComponent(request.headers.get("x-meeting-title") ?? originalFilename).slice(0, 200);
  const recordingDateHeader = request.headers.get("x-recording-date");
  const recordingDate = recordingDateHeader && /^\d{4}-\d{2}-\d{2}$/.test(recordingDateHeader) ? new Date(`${recordingDateHeader}T12:00:00Z`) : null;
  const extension = extname(originalFilename).slice(1);
  const storageKey = newStorageKey("original", extension);
  const output = await createStorageWriteStream(storageKey);
  const hash = createHash("sha256"); let size = 0;
  const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) { size += chunk.length; if (size > getEnv().MAX_UPLOAD_BYTES) callback(new Error("Upload exceeds configured limit")); else { hash.update(chunk); callback(null, chunk); } } });
  try { await pipeline(Readable.fromWeb(request.body as import("node:stream/web").ReadableStream), meter, output); }
  catch (error) { const failedPath = await resolveStorageKey(storageKey); await import("node:fs/promises").then((fs) => fs.unlink(failedPath).catch(() => undefined)); return NextResponse.json({ error: error instanceof Error ? error.message : "Upload failed" }, { status: 413 }); }
  const result = await db.$transaction(async (tx) => {
    const meeting = await tx.meeting.create({ data: { title, recordingDate, state: "QUEUED", recordings: { create: { storageKey, originalFilename, byteSize: BigInt(size), sha256: hash.digest("hex") } } } });
    const job = await tx.processingJob.create({ data: { meetingId: meeting.id } });
    await tx.auditEvent.create({ data: { userId, meetingId: meeting.id, action: "meeting.upload", entityType: "Meeting", entityId: meeting.id, metadata: { originalFilename, byteSize: size } } });
    return { meeting, job };
  }).catch(async (error: unknown) => {
    const failedPath = await resolveStorageKey(storageKey);
    await import("node:fs/promises").then((fs) => fs.unlink(failedPath).catch(() => undefined));
    throw error;
  });
  try { const bullJobId = await enqueuePipeline(result.job.id, result.job.attempt); await db.processingJob.update({ where: { id: result.job.id }, data: { bullJobId } }); await publishProcessingUpdate(result.meeting.id); }
  catch (error) { await db.processingJob.update({ where: { id: result.job.id }, data: { state: "FAILED", errorMessage: error instanceof Error ? error.message : "Queue unavailable" } }); await publishProcessingUpdate(result.meeting.id); return NextResponse.json({ meetingId: result.meeting.id, error: "Stored safely, but queue unavailable; retry required" }, { status: 503 }); }
  return NextResponse.json({ meetingId: result.meeting.id, jobId: result.job.id }, { status: 202 });
}
