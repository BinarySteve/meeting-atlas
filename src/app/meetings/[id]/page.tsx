import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { meetingOutputSchema } from "@/lib/summarization";
import { MeetingWorkspace } from "./meeting-workspace";
import { getProcessingSnapshot } from "@/lib/processing-status";

export const dynamic = "force-dynamic";

export default async function MeetingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string }> }) {
  await requireUserId();
  const { id } = await params;
  const view = (await searchParams).view ?? "transcript";
  const meeting = await db.meeting.findUnique({
    where: { id },
    include: {
      recordings: { orderBy: { createdAt: "asc" } },
      speakers: { orderBy: { displayName: "asc" } },
      activeTranscriptVersion: { include: { segments: { include: { speaker: true }, orderBy: { ordinal: "asc" } } } },
      transcriptVersions: { select: { id: true, version: true, source: true, createdAt: true }, orderBy: { version: "desc" } },
      summaries: { where: { status: "COMPLETED" }, include: { transcriptVersion: { select: { version: true } } }, orderBy: { version: "desc" } },
      audits: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!meeting) notFound();
  const processing = await getProcessingSnapshot(id);
  const transcript = meeting.activeTranscriptVersion ?? await db.transcriptVersion.findFirst({ where: { meetingId: id }, include: { segments: { include: { speaker: true }, orderBy: { ordinal: "asc" } } }, orderBy: { version: "desc" } });
  const activeSummary = meeting.summaries.find((summary) => summary.id === meeting.activeSummaryVersionId) ?? meeting.summaries.find((summary) => summary.transcriptVersionId === transcript?.id);
  const activeSpeakerIds = new Set(transcript?.segments.flatMap((segment) => segment.speakerId ? [segment.speakerId] : []) ?? []);
  const activeSpeakers = meeting.speakers.filter((speaker) => activeSpeakerIds.has(speaker.id));
  const [actions, decisions, questions] = activeSummary ? await Promise.all([
    db.actionItem.findMany({ where: { meetingId: id, OR: [{ summaryVersionId: activeSummary.id }, { summaryVersionId: null }] }, orderBy: { id: "asc" } }),
    db.decision.findMany({ where: { meetingId: id, OR: [{ summaryVersionId: activeSummary.id }, { summaryVersionId: null }] }, orderBy: { id: "asc" } }),
    db.openQuestion.findMany({ where: { meetingId: id, OR: [{ summaryVersionId: activeSummary.id }, { summaryVersionId: null }] }, orderBy: { id: "asc" } }),
  ]) : [[], [], []];
  const recording = meeting.recordings[0];
  const duration = recording?.durationMs ? formatDuration(Number(recording.durationMs)) : "Duration pending";
  const meetingDate = meeting.recordingDate ?? meeting.createdAt;
  return <main className="meeting-page">
    <Link className="back-link" href="/">← Meetings</Link>
    <header className="meeting-detail-header">
      <div><p className="eyebrow">Meeting workspace</p><h1>{meeting.title}</h1><div className="meeting-detail-meta"><time>{meetingDate.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</time><span>{meetingDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span><span>{duration}</span><span>{activeSpeakers.length} {activeSpeakers.length === 1 ? "speaker" : "speakers"}</span><span className={`status-badge status-${meeting.state.toLowerCase()}`}><span aria-hidden="true"/>{humanize(meeting.state)}</span></div></div>
      <div className="meeting-detail-actions"><a className="button secondary" href={`/api/meetings/${meeting.id}/exports?format=md`}>Export</a><Link className="button tertiary" href={view === "details" ? "?view=transcript" : "?view=details"} scroll={false}>{view === "details" ? "Workspace" : "Details"}</Link></div>
    </header>
    <MeetingWorkspace
      meetingId={meeting.id}
      meetingTitle={meeting.title}
      recordingUrl={recording ? `/api/meetings/${meeting.id}/recording${recording.normalizedStorageKey ? "?variant=playback" : ""}` : undefined}
      recordingName={recording?.originalFilename ?? null}
      initialProcessing={processing!}
      initialView={view}
      transcript={transcript ? { id: transcript.id, version: transcript.version, segments: transcript.segments.map((segment) => ({ id: segment.id, startMs: Number(segment.startMs), endMs: Number(segment.endMs), text: segment.text, speakerId: segment.speakerId, speakerName: segment.speaker?.displayName ?? "Unassigned", excluded: segment.excludedFromSummary })) } : undefined}
      activeTranscriptSource={transcript?.source ?? null}
      transcriptVersions={meeting.transcriptVersions.map((version) => ({ id: version.id, version: version.version, source: version.source, createdAtLabel: version.createdAt.toLocaleString(), active: version.id === transcript?.id }))}
      speakers={activeSpeakers.map((speaker) => ({ id: speaker.id, displayName: speaker.displayName }))}
      summaries={meeting.summaries.map((summary) => { const output = meetingOutputSchema.safeParse(summary.content).data; return { id: summary.id, version: summary.version, transcriptVersion: summary.transcriptVersion.version, summary: output?.summary ?? "Structured summary unavailable", keyPoints: output?.importantClaims.map((claim) => ({ text: claim.text, evidence: claim.evidenceSegmentIds })) ?? [] }; })}
      activeSummaryId={activeSummary?.id ?? null}
      actions={actions.map((item) => ({ id: item.id, description: item.description, owner: item.typedOwner, dueDate: item.dueDate?.toISOString().slice(0, 10) ?? null, status: item.status, rejected: Boolean(item.rejectedAt), evidence: item.evidenceSegmentIds }))}
      decisions={decisions.map((item) => ({ id: item.id, text: item.text, evidence: item.evidenceSegmentIds }))}
      questions={questions.map((item) => ({ id: item.id, text: item.text, evidence: item.evidenceSegmentIds }))}
      retention={{ until: meeting.retentionUntil?.toISOString().slice(0, 10) ?? null, protected: meeting.protectedFromRetention }}
      audits={meeting.audits.map((event) => ({ id: event.id, createdAtLabel: event.createdAt.toLocaleString(), action: event.action, entityType: event.entityType }))}
    />
  </main>;
}

function humanize(value: string) { return value.replaceAll("_", " ").toLowerCase(); }
function formatDuration(ms: number) { const totalSeconds = Math.round(ms / 1000); const hours = Math.floor(totalSeconds / 3600); const minutes = Math.floor((totalSeconds % 3600) / 60); return hours ? `${hours}h ${minutes}m` : `${minutes} min`; }
