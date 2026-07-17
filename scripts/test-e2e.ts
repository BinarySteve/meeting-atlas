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
    include: { transcriptVersions: { include: { segments: true } }, summaries: true, actionItems: true, decisions: true, openQuestions: true, jobs: { include: { stages: true }, orderBy: { createdAt: "desc" }, take: 1 } },
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
  const transcriptVersionId = meeting.transcriptVersions[0]?.id;
  assert.ok(transcriptVersionId);
  const regenerate = () => fetch(`http://127.0.0.1:6982/api/meetings/${meetingId}/summaries/regenerate`, { method: "POST", headers: { cookie: `meeting_session=${token}`, "content-type": "application/json" }, body: JSON.stringify({ transcriptVersionId }) });
  const regenerationResponses = await Promise.all([regenerate(), regenerate()]);
  assert.deepEqual(regenerationResponses.map((response) => response.status).sort(), [202, 409]);
  const regenerationDeadline = Date.now() + 10 * 60_000;
  while (Date.now() < regenerationDeadline) {
    const latest = await db.processingJob.findFirstOrThrow({ where: { meetingId, kind: "SUMMARY_REGENERATION" }, orderBy: { createdAt: "desc" }, select: { state: true, activeStage: true } });
    console.log(JSON.stringify({ event: "summary_regeneration_progress", state: latest.state, stage: latest.activeStage }));
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(latest.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  meeting = await db.meeting.findUniqueOrThrow({ where: { id: meetingId }, include: { transcriptVersions: { include: { segments: true } }, summaries: true, actionItems: true, decisions: true, openQuestions: true, jobs: { include: { stages: true }, orderBy: { createdAt: "desc" } } } });
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
  console.log("Full local AI pipeline and authenticated UI/export passed");
}

main().finally(async () => {
  if (meetingId) await deleteMeetingData(meetingId).catch(() => undefined);
  if (sessionId) await db.session.deleteMany({ where: { id: sessionId } });
  if (ownsFixture) await rm(fixture, { force: true });
  await db.$disconnect();
}).catch((error: unknown) => { console.error(error instanceof Error ? error.message : "E2E failed"); process.exitCode = 1; });
