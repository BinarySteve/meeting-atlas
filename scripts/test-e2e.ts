import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { issueSessionToken } from "../src/lib/auth";
import { db } from "../src/lib/db";
import { deleteMeetingData } from "../src/lib/retention";

const ownsFixture = !process.env.E2E_FIXTURE;
const fixture = process.env.E2E_FIXTURE ?? path.resolve(".test-storage/synthetic-meeting.wav");
let meetingId: string | undefined;
let sessionId: string | undefined;

async function waitForJob(kind: "SUMMARY_REGENERATION" | "TRANSCRIPT_REPROCESS", timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const latest = await db.processingJob.findFirstOrThrow({
      where: { meetingId, kind },
      orderBy: { createdAt: "desc" },
      select: { state: true, activeStage: true },
    });
    console.log(JSON.stringify({ event: `${kind.toLowerCase()}_progress`, state: latest.state, stage: latest.activeStage }));
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(latest.state)) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  assert.fail(`${kind} did not finish before its deadline`);
}

async function main(): Promise<void> {
  const owner = await db.user.findFirst({ select: { id: true } });
  assert.ok(owner, "Create owner account before E2E test");
  sessionId = randomUUID();
  await db.session.create({ data: { id: sessionId, userId: owner.id, expiresAt: new Date(Date.now() + 43_200_000) } });
  const token = await issueSessionToken(owner.id, sessionId);
  const upload = await fetch("http://127.0.0.1:6982/api/meetings/upload", {
    method: "POST",
    headers: { cookie: `meeting_session=${token}`, "x-filename": "synthetic-meeting.wav", "x-meeting-title": "Synthetic E2E Meeting" },
    body: await readFile(fixture),
  });
  const uploadText = await upload.text();
  const uploaded = JSON.parse(uploadText || "{}") as { meetingId?: string; error?: string };
  assert.equal(upload.status, 202, uploaded.error);
  assert.ok(uploaded.meetingId);
  meetingId = uploaded.meetingId;
  const streamAbort = new AbortController();
  const processingStream = await fetch(`http://127.0.0.1:6982/api/meetings/${meetingId}/processing`, { headers: { cookie: `meeting_session=${token}` }, signal: streamAbort.signal });
  assert.equal(processingStream.status, 200);
  assert.match(processingStream.headers.get("content-type") ?? "", /text\/event-stream/);
  const firstEvent = await processingStream.body?.getReader().read();
  streamAbort.abort();
  assert.match(new TextDecoder().decode(firstEvent?.value), /event: processing/);
  const deadline = Date.now() + 30 * 60_000;
  while (Date.now() < deadline) {
    const meeting = await db.meeting.findUniqueOrThrow({ where: { id: meetingId }, select: { state: true, activeStage: true } });
    console.log(JSON.stringify({ event: "e2e_progress", state: meeting.state, stage: meeting.activeStage }));
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(meeting.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  let meeting = await db.meeting.findUniqueOrThrow({
    where: { id: meetingId },
    include: { recordings: true, transcriptVersions: { include: { segments: { orderBy: { ordinal: "asc" } } }, orderBy: { version: "asc" } }, summaries: true, actionItems: true, decisions: true, openQuestions: true, jobs: { include: { stages: true }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (meeting.state !== "COMPLETED") {
    console.error(JSON.stringify({ event: "e2e_failed", state: meeting.state, stages: meeting.jobs[0]?.stages.map((stage) => ({ stage: stage.stage, state: stage.state, error: stage.errorMessage?.slice(0, 300) })) }));
  }
  assert.equal(meeting.state, "COMPLETED");
  assert.ok(meeting.transcriptVersions.some((version) => version.segments.length > 0));
  assert.ok(meeting.summaries.some((summary) => summary.status === "COMPLETED"));
  assert.ok(meeting.actionItems.length > 0);
  assert.ok(meeting.decisions.length > 0);
  assert.ok(meeting.openQuestions.length > 0);
  const originalTranscript = meeting.transcriptVersions[0];
  const transcriptVersionId = originalTranscript?.id;
  assert.ok(transcriptVersionId);
  assert.equal(meeting.activeTranscriptVersionId, transcriptVersionId);
  const recordingDurationMs = Number(meeting.recordings[0]?.durationMs);
  assert.ok(recordingDurationMs > 0);
  assert.ok(originalTranscript.segments.every((segment) => Number(segment.startMs) >= 0 && Number(segment.endMs) <= recordingDurationMs + 1_000));
  const largestSilenceMs = Math.max(...originalTranscript.segments.slice(1).map((segment, index) => Number(segment.startMs - originalTranscript.segments[index].endMs)));
  assert.ok(largestSilenceMs >= 6_000, `Expected preserved fixture silence, observed ${largestSilenceMs}ms`);
  const originalSegments = originalTranscript.segments.map((segment) => ({ startMs: segment.startMs, endMs: segment.endMs, text: segment.text, speakerId: segment.speakerId }));

  const reprocess = () => fetch(`http://127.0.0.1:6982/api/meetings/${meetingId}/transcript/reprocess`, { method: "POST", headers: { cookie: `meeting_session=${token}` } });
  const reprocessResponses = await Promise.all([reprocess(), reprocess()]);
  assert.deepEqual(reprocessResponses.map((response) => response.status).sort(), [202, 409]);
  await waitForJob("TRANSCRIPT_REPROCESS", 30 * 60_000);
  meeting = await db.meeting.findUniqueOrThrow({ where: { id: meetingId }, include: { recordings: true, transcriptVersions: { include: { segments: { orderBy: { ordinal: "asc" } } }, orderBy: { version: "asc" } }, summaries: true, actionItems: true, decisions: true, openQuestions: true, jobs: { include: { stages: true }, orderBy: { createdAt: "desc" } } } });
  const reprocessing = meeting.jobs.find((job) => job.kind === "TRANSCRIPT_REPROCESS");
  const reprocessedTranscript = meeting.transcriptVersions.at(-1);
  assert.equal(reprocessing?.state, "COMPLETED");
  assert.equal(meeting.transcriptVersions.length, 2);
  assert.deepEqual(meeting.transcriptVersions[0].segments.map((segment) => ({ startMs: segment.startMs, endMs: segment.endMs, text: segment.text, speakerId: segment.speakerId })), originalSegments);
  assert.equal(reprocessedTranscript?.source, "MACHINE");
  assert.equal(reprocessedTranscript?.parentId, transcriptVersionId);
  assert.equal(meeting.activeTranscriptVersionId, reprocessedTranscript?.id);
  assert.ok(meeting.summaries.some((summary) => summary.status === "COMPLETED" && summary.transcriptVersionId === reprocessedTranscript?.id));

  const activeTranscriptVersionId = reprocessedTranscript?.id;
  assert.ok(activeTranscriptVersionId);
  const regenerate = () => fetch(`http://127.0.0.1:6982/api/meetings/${meetingId}/summaries/regenerate`, { method: "POST", headers: { cookie: `meeting_session=${token}`, "content-type": "application/json" }, body: JSON.stringify({ transcriptVersionId: activeTranscriptVersionId }) });
  const regenerationResponses = await Promise.all([regenerate(), regenerate()]);
  assert.deepEqual(regenerationResponses.map((response) => response.status).sort(), [202, 409]);
  await waitForJob("SUMMARY_REGENERATION", 10 * 60_000);
  meeting = await db.meeting.findUniqueOrThrow({ where: { id: meetingId }, include: { recordings: true, transcriptVersions: { include: { segments: { orderBy: { ordinal: "asc" } } }, orderBy: { version: "asc" } }, summaries: true, actionItems: true, decisions: true, openQuestions: true, jobs: { include: { stages: true }, orderBy: { createdAt: "desc" } } } });
  const regeneration = meeting.jobs.find((job) => job.kind === "SUMMARY_REGENERATION");
  assert.equal(regeneration?.state, "COMPLETED");
  assert.ok(meeting.summaries.length >= 2);
  const summarizationStage = regeneration?.stages.find((stage) => stage.stage === "summarization" && stage.state === "COMPLETED");
  assert.ok((summarizationStage?.progressTotal ?? 0) > 0);
  assert.equal(summarizationStage?.progressCurrent, summarizationStage?.progressTotal);
  const page = await fetch(`http://127.0.0.1:6982/meetings/${meetingId}`, { headers: { cookie: `meeting_session=${token}` } });
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.ok(html.includes("Synthetic E2E Meeting"));
  assert.ok(html.includes("Exports"));
  const exported = await fetch(`http://127.0.0.1:6982/api/meetings/${meetingId}/exports?format=json`, { headers: { cookie: `meeting_session=${token}` } });
  assert.equal(exported.status, 200);
  const json = await exported.json() as { title?: string };
  assert.equal(json.title, "Synthetic E2E Meeting");

  const segmentToEdit = reprocessedTranscript.segments[0];
  assert.ok(segmentToEdit);
  const edited = await fetch(`http://127.0.0.1:6982/api/meetings/${meetingId}/transcript`, {
    method: "POST",
    headers: { cookie: `meeting_session=${token}`, "content-type": "application/json" },
    body: JSON.stringify({ baseVersionId: activeTranscriptVersionId, edit: { action: "edit_text", segmentId: segmentToEdit.id, text: `${segmentToEdit.text} corrected` } }),
  });
  assert.equal(edited.status, 200);
  const protectedReprocess = await reprocess();
  assert.equal(protectedReprocess.status, 409);
  console.log("Full local AI pipeline and authenticated UI/export passed");
}

main().finally(async () => {
  if (meetingId) await deleteMeetingData(meetingId).catch(() => undefined);
  if (sessionId) await db.session.deleteMany({ where: { id: sessionId } });
  if (ownsFixture) await rm(fixture, { force: true });
  await db.$disconnect();
}).catch((error: unknown) => { console.error(error instanceof Error ? error.message : "E2E failed"); process.exitCode = 1; });
