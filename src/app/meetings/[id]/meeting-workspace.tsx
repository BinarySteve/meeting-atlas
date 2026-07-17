"use client";

import type { ItemStatus } from "@prisma/client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { groupTranscriptSegments, type TranscriptGroup } from "@/lib/transcript-display";
import type { ProcessingSnapshot } from "@/lib/processing-status";
import { MeetingDeleteButton } from "@/app/meeting-delete-button";

type Speaker = { id: string; displayName: string };
type Segment = { id: string; startMs: number; endMs: number; text: string; speakerId: string | null; speakerName: string; excluded: boolean };
type EvidenceItem = { id: string; text: string; evidence: string[] };
type Summary = { id: string; version: number; transcriptVersion: number; summary: string; keyPoints: Array<{ text: string; evidence: string[] }> };
type Action = { id: string; description: string; owner: string | null; dueDate: string | null; status: ItemStatus; rejected: boolean; evidence: string[] };
type Audit = { id: string; createdAtLabel: string; action: string; entityType: string };
type View = "transcript" | "summary" | "actions" | "details";
type InsightTab = "summary" | "actions" | "decisions" | "topics";

export function MeetingWorkspace(props: {
  meetingId: string;
  meetingTitle: string;
  recordingUrl?: string;
  recordingName: string | null;
  initialProcessing: ProcessingSnapshot;
  initialView: string;
  transcript?: { id: string; version: number; segments: Segment[] };
  speakers: Speaker[];
  summaries: Summary[];
  activeSummaryId: string | null;
  actions: Action[];
  decisions: EvidenceItem[];
  questions: EvidenceItem[];
  retention: { until: string | null; protected: boolean };
  audits: Audit[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const audio = useRef<HTMLAudioElement>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [followTranscript, setFollowTranscript] = useState(true);
  const [compactTranscript, setCompactTranscript] = useState(true);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [transcriptQuery, setTranscriptQuery] = useState("");
  const [processing, setProcessing] = useState(props.initialProcessing);
  const [streamConnected, setStreamConnected] = useState(false);
  const [summarySubmitting, setSummarySubmitting] = useState(false);
  const [processingActionBusy, setProcessingActionBusy] = useState(false);
  const [speakerEditorOpen, setSpeakerEditorOpen] = useState(false);
  const requestedView = searchParams.get("view") ?? props.initialView;
  const view = (["transcript", "summary", "actions", "details"] as const).find((item) => item === requestedView) ?? "transcript";
  const [insightTab, setInsightTab] = useState<InsightTab>(view === "actions" ? "actions" : "summary");
  const lastJobState = useRef(props.initialProcessing.job?.state);
  const segments = useMemo(() => props.transcript?.segments ?? [], [props.transcript?.segments]);
  const segmentById = useMemo(() => new Map(segments.map((segment) => [segment.id, segment])), [segments]);
  const segmentIndex = useMemo(() => new Map(segments.map((segment, index) => [segment.id, index])), [segments]);
  const transcriptGroups = useMemo<TranscriptGroup<Segment>[]>(() => compactTranscript
    ? groupTranscriptSegments(segments)
    : segments.map((segment) => ({ id: segment.id, startMs: segment.startMs, endMs: segment.endMs, text: segment.text, speakerName: segment.speakerName, partiallyUnassigned: false, segments: [segment] })), [compactTranscript, segments]);
  const visibleGroups = useMemo(() => { const query = transcriptQuery.trim().toLocaleLowerCase(); return query ? transcriptGroups.filter((group) => group.text.toLocaleLowerCase().includes(query) || group.speakerName.toLocaleLowerCase().includes(query)) : transcriptGroups; }, [transcriptGroups, transcriptQuery]);
  const timelineGroups = useMemo(() => transcriptGroups.filter((_, index) => index === 0 || index % Math.max(1, Math.ceil(transcriptGroups.length / 7)) === 0).slice(0, 8), [transcriptGroups]);
  const activeSegment = segments.find((segment) => currentMs >= segment.startMs && currentMs < segment.endMs);
  const activeGroup = activeSegment ? transcriptGroups.find((group) => group.segments.some((segment) => segment.id === activeSegment.id)) : undefined;
  const activeSummary = props.summaries.find((summary) => summary.id === props.activeSummaryId) ?? props.summaries[0];

  useEffect(() => {
    if (!followTranscript || !activeGroup || audio.current?.paused) return;
    document.getElementById(`transcript-group-${activeGroup.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeGroup, followTranscript]);

  useEffect(() => {
    const events = new EventSource(`/api/meetings/${props.meetingId}/processing`);
    events.addEventListener("open", () => setStreamConnected(true));
    events.addEventListener("processing", (event) => {
      const next = JSON.parse((event as MessageEvent<string>).data) as ProcessingSnapshot;
      const prior = lastJobState.current;
      const priorActive = prior ? ["QUEUED", "ACTIVE", "RETRYING", "CANCEL_REQUESTED"].includes(prior) : false;
      setProcessing(next);
      lastJobState.current = next.job?.state;
      if (priorActive && !next.active) router.refresh();
    });
    events.addEventListener("error", () => setStreamConnected(false));
    return () => events.close();
  }, [props.meetingId, router]);

  function seek(target: Pick<Segment, "startMs">) {
    if (!audio.current) return;
    audio.current.currentTime = target.startMs / 1000;
    setCurrentMs(target.startMs);
    void audio.current.play();
  }

  function skip(seconds: number) {
    if (!audio.current) return;
    audio.current.currentTime = Math.max(0, Math.min(audio.current.duration || 0, audio.current.currentTime + seconds));
  }

  function togglePlayback() {
    const node = audio.current;
    if (!node) return;
    if (node.paused) void node.play(); else node.pause();
  }

  function seekPosition(next: number) {
    if (audio.current) audio.current.currentTime = next / 1000;
    setCurrentMs(next);
  }

  function changeRate(rate: number) { if (audio.current) audio.current.playbackRate = rate; }
  function changeVolume(next: number) { setVolume(next); if (audio.current) audio.current.volume = next; }

  async function request(url: string, method: "POST" | "PATCH", body?: unknown) {
    setMessage("Saving…");
    const response = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json() as { error?: string };
    setMessage(response.ok ? "Saved" : result.error ?? "Request failed");
    if (response.ok) router.refresh();
    return response.ok;
  }

  async function edit(editRequest: Record<string, unknown>) {
    if (props.transcript) await request(`/api/meetings/${props.meetingId}/transcript`, "POST", { baseVersionId: props.transcript.id, edit: editRequest });
  }

  async function regenerateSummary() {
    if (!props.transcript || processing.active || summarySubmitting) return;
    setSummarySubmitting(true);
    setMessage("Starting summary regeneration…");
    try {
      const response = await fetch(`/api/meetings/${props.meetingId}/summaries/regenerate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transcriptVersionId: props.transcript.id }) });
      const result = await response.json() as { error?: string; processing?: ProcessingSnapshot };
      if (result.processing) { setProcessing(result.processing); lastJobState.current = result.processing.job?.state; }
      setMessage(response.ok ? "Summary regeneration queued" : response.status === 409 ? "Processing is already running" : result.error ?? "Could not start summary regeneration");
    } finally { setSummarySubmitting(false); }
  }

  async function processingAction(action: "retry" | "cancel") {
    const job = processing.job;
    if (!job || processingActionBusy) return;
    setProcessingActionBusy(true);
    try {
      const response = await fetch(`/api/jobs/${job.id}/${action}`, { method: "POST" });
      const result = await response.json() as { error?: string };
      setMessage(response.ok ? (action === "cancel" ? "Cancellation requested" : "Retry queued") : result.error ?? "Request failed");
    } finally { setProcessingActionBusy(false); }
  }

  function changeView(next: View) {
    if (next === "summary" || next === "actions") setInsightTab(next);
    const query = new URLSearchParams(searchParams.toString());
    query.set("view", next);
    router.push(`?${query}`, { scroll: false });
  }

  return <>
    <nav className="workspace-tabs" aria-label="Meeting sections">{(["transcript", "summary", "actions", "details"] as const).map((tab) => <button key={tab} aria-current={view === tab ? "page" : undefined} onClick={() => changeView(tab)}>{tab}</button>)}</nav>
    <ProcessingStatusCard processing={processing} connected={streamConnected} busy={processingActionBusy} onAction={processingAction}/>

    <div className="workspace-main">
      <section className="timeline-panel desktop-only" aria-label="Meeting timeline">
        <p className="panel-label">Timeline</p>
        <h2>Highlights</h2>
        {timelineGroups.length ? <ol className="timeline-list">{timelineGroups.map((group, index) => <li key={group.id}><button className={activeGroup?.id === group.id ? "active" : ""} onClick={() => seek(group)}><time>{formatMs(group.startMs)}</time><span>{index === 0 ? "Introduction" : truncate(group.text, 34)}</span></button></li>)}</ol> : <p className="empty compact-empty">Highlights appear after transcription.</p>}
        <div className="speaker-filter"><p className="panel-label">Speakers</p>{props.speakers.map((speaker, index) => { const first = segments.find((segment) => segment.speakerId === speaker.id); return <button key={speaker.id} disabled={!first} onClick={() => first && seek(first)}><span className={`speaker-dot speaker-${index % 5}`}/>{speaker.displayName}</button>; })}</div>
      </section>

      <section className={`transcript-panel ${view !== "transcript" ? "mobile-hidden" : ""}`}>
        <div className="panel-heading"><div><p className="panel-label">Transcript</p><h2>Conversation</h2></div><div className="panel-heading-actions"><button type="button" className="compact-button" onClick={() => setSpeakerEditorOpen(true)}>Edit speakers</button><button type="button" className="compact-button" aria-pressed={compactTranscript} onClick={() => setCompactTranscript((value) => !value)}>{compactTranscript ? "Source view" : "Compact view"}</button></div></div>
        {props.transcript && <div className="transcript-search"><label className="sr-only" htmlFor="transcript-search">Search transcript</label><input id="transcript-search" type="search" value={transcriptQuery} onChange={(event) => setTranscriptQuery(event.target.value)} placeholder="Search in transcript"/><span role="status">{transcriptQuery ? `${visibleGroups.length} matches` : `${transcriptGroups.length} passages`}</span></div>}
        {props.transcript ? <div className="transcript">{visibleGroups.map((group) => <article id={`transcript-group-${group.id}`} className={`segment-row ${activeGroup?.id === group.id ? "active" : ""}`} key={group.id} onDoubleClick={() => seek(group)}>
          <button className="seek" onClick={() => seek(group)} aria-label={`Play from ${formatMs(group.startMs)}`}>{formatMs(group.startMs)}</button>
          <div className="speaker-name"><span className={`speaker-dot speaker-${Math.max(0, props.speakers.findIndex((speaker) => speaker.displayName === group.speakerName)) % 5}`}/><strong>{group.speakerName}</strong>{group.partiallyUnassigned && <small>Speaker timing uncertain</small>}</div>
          <p>{group.text}</p>
          <div className="segment-editor"><button className="edit-toggle" aria-expanded={editingGroupId === group.id} onClick={() => setEditingGroupId((value) => value === group.id ? null : group.id)}>Edit {group.segments.length === 1 ? "segment" : `${group.segments.length} source segments`}</button>{editingGroupId === group.id && <div className="source-segments">{group.segments.map((segment) => <SegmentEditor key={segment.id} segment={segment} speakers={props.speakers} nextSegment={segments[(segmentIndex.get(segment.id) ?? -1) + 1]} onEdit={edit}/>)}</div>}</div>
        </article>)}{visibleGroups.length === 0 && <p className="empty">No transcript passages match.</p>}</div> : <p className="empty">Transcript becomes available after transcription and alignment.</p>}
      </section>

      <section className={`insights-panel ${view === "transcript" || view === "details" ? "mobile-hidden" : ""}`}>
        <div className="insight-tabs" role="tablist" aria-label="Meeting intelligence">{(["summary", "actions", "decisions", "topics"] as const).map((tab) => <button key={tab} role="tab" aria-selected={insightTab === tab} onClick={() => setInsightTab(tab)}>{tab === "actions" ? `Actions ${props.actions.length}` : tab}</button>)}</div>
        {insightTab === "summary" && <div className="insight-content"><div className="insight-heading"><div><p className="panel-label">AI summary</p><h2>Summary</h2></div><button disabled={!props.transcript || processing.active || summarySubmitting} onClick={() => void regenerateSummary()}>{summarySubmitting ? "Starting…" : "Regenerate"}</button></div>{activeSummary ? <><p className="summary-copy">{activeSummary.summary}</p>{activeSummary.keyPoints.length > 0 && <><h3>Key points</h3><ul className="key-points">{activeSummary.keyPoints.map((point, index) => <li key={`${point.text}-${index}`}><span>✦</span><div>{point.text}<Evidence ids={point.evidence} segments={segmentById} onSeek={seek}/></div></li>)}</ul></>}{props.questions.length > 0 && <><h3>Open questions</h3>{props.questions.map((item) => <article className="question-item" key={item.id}><p>{item.text}</p><Evidence ids={item.evidence} segments={segmentById} onSeek={seek}/></article>)}</>}<details className="version-history"><summary>Summary versions</summary>{props.summaries.map((summary) => <div key={summary.id}><span>Version {summary.version} · transcript {summary.transcriptVersion}</span>{summary.id !== props.activeSummaryId && <button onClick={() => void request(`/api/meetings/${props.meetingId}/summaries/${summary.id}/restore`, "POST")}>Restore</button>}</div>)}</details></> : <p className="empty">Summary appears when local processing completes.</p>}</div>}
        {insightTab === "actions" && <div className="insight-content"><p className="panel-label">Follow-up</p><h2>Action items</h2>{props.actions.length ? <div className="action-list">{props.actions.map((item) => <ActionItem key={item.id} item={item} meetingId={props.meetingId} segments={segmentById} onRequest={request} onSeek={seek}/>)}</div> : <p className="empty">No action items found.</p>}</div>}
        {insightTab === "decisions" && <div className="insight-content"><p className="panel-label">Outcomes</p><h2>Decisions</h2>{props.decisions.length ? props.decisions.map((item) => <article className="item-card decision-card" key={item.id}><p>{item.text}</p><Evidence ids={item.evidence} segments={segmentById} onSeek={seek}/></article>) : <p className="empty">No explicit decisions found.</p>}</div>}
        {insightTab === "topics" && <div className="insight-content"><p className="panel-label">Topics</p><h2>Detected topics</h2><p className="empty">Topic extraction is not provided by the current processing contract. Transcript highlights remain available in the timeline.</p></div>}
      </section>
    </div>

    {props.recordingUrl && <audio className="meeting-audio" ref={audio} preload="metadata" src={props.recordingUrl} onLoadedMetadata={(event) => setDurationMs(event.currentTarget.duration * 1000)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={(event) => setCurrentMs(event.currentTarget.currentTime * 1000)}/>} 
    <AudioPlayer recordingUrl={props.recordingUrl} playing={playing} currentMs={currentMs} durationMs={durationMs} volume={volume} followTranscript={followTranscript} activeSpeaker={activeSegment?.speakerName} onToggle={togglePlayback} onSeek={seekPosition} onRate={changeRate} onVolume={changeVolume} onSkip={skip} onFollow={() => setFollowTranscript((value) => !value)}/>

    <section className={`details-panel ${view !== "details" ? "mobile-hidden" : ""}`}>
      <div className="details-grid"><div><p className="panel-label">Processing</p><h2>Pipeline details</h2><PipelineDetails processing={processing} onRequest={request}/></div><div><p className="panel-label">People</p><h2>Speakers</h2><div className="speaker-grid">{props.speakers.map((speaker) => <form key={speaker.id} onSubmit={(event) => { event.preventDefault(); void request(`/api/meetings/${props.meetingId}/speakers/${speaker.id}`, "PATCH", { displayName: String(new FormData(event.currentTarget).get("name") ?? "") }); }}><label htmlFor={`speaker-${speaker.id}`}>Speaker name</label><input id={`speaker-${speaker.id}`} name="name" defaultValue={speaker.displayName} maxLength={100} required/><button>Rename</button></form>)}</div></div><div><p className="panel-label">Files</p><h2>Export</h2><div className="button-row">{["txt", "md", "json", "srt", "vtt"].map((format) => <a className="button" href={`/api/meetings/${props.meetingId}/exports?format=${format}`} key={format}>{format.toUpperCase()}</a>)}</div></div><div><p className="panel-label">Privacy</p><h2>Retention</h2><form className="retention-form" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void request(`/api/meetings/${props.meetingId}`, "PATCH", { retentionUntil: String(data.get("until") || "") || null, protectedFromRetention: data.get("protected") === "on" }); }}><label>Delete after<input name="until" type="date" defaultValue={props.retention.until ?? ""}/></label><label className="checkbox"><input name="protected" type="checkbox" defaultChecked={props.retention.protected}/> Protect from automatic retention</label><button>Save retention</button></form><MeetingDeleteButton meetingId={props.meetingId} meetingTitle={props.meetingTitle}/></div></div>
      <details className="audit-details"><summary>Audit history</summary>{props.audits.length ? <ol className="audit-list">{props.audits.map((event) => <li key={event.id}><time>{event.createdAtLabel}</time><strong>{event.action}</strong><span>{event.entityType}</span></li>)}</ol> : <p className="empty">No audited changes yet.</p>}</details>
    </section>
    <p role="status" className="sticky-status">{message}</p>
    <SpeakerEditorDialog open={speakerEditorOpen} speakers={props.speakers} meetingId={props.meetingId} onClose={() => setSpeakerEditorOpen(false)} onRequest={request}/>
  </>;
}

function SpeakerEditorDialog({ open, speakers, meetingId, onClose, onRequest }: { open: boolean; speakers: Speaker[]; meetingId: string; onClose: () => void; onRequest: (url: string, method: "POST" | "PATCH", body?: unknown) => Promise<boolean> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);
  return <dialog ref={dialog} className="speaker-editor-dialog" onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={onClose}>
    <div className="modal-heading"><div><p className="panel-label">People</p><h2>Edit speaker names</h2><p>Replace automatic labels with names you recognize.</p></div><button type="button" className="modal-close" aria-label="Close speaker editor" onClick={onClose}>×</button></div>
    <div className="speaker-grid">{speakers.length ? speakers.map((speaker) => <form key={speaker.id} onSubmit={(event) => { event.preventDefault(); void onRequest(`/api/meetings/${meetingId}/speakers/${speaker.id}`, "PATCH", { displayName: String(new FormData(event.currentTarget).get("name") ?? "") }); }}><label htmlFor={`modal-speaker-${speaker.id}`}>Current label: {speaker.displayName}</label><input id={`modal-speaker-${speaker.id}`} name="name" defaultValue={speaker.displayName} maxLength={100} required/><button>Save name</button></form>) : <p className="empty">Speakers appear after diarization completes.</p>}</div>
  </dialog>;
}

function AudioPlayer(props: { recordingUrl?: string; playing: boolean; currentMs: number; durationMs: number; volume: number; followTranscript: boolean; activeSpeaker?: string; onToggle: () => void; onSeek: (value: number) => void; onRate: (value: number) => void; onVolume: (value: number) => void; onSkip: (seconds: number) => void; onFollow: () => void }) {
  if (!props.recordingUrl) return <div className="recording-panel"><p className="empty">Recording unavailable.</p></div>;
  return <section className="recording-panel" aria-label="Meeting playback">
    <div className="playback-heading"><span>Now speaking</span><strong title={props.activeSpeaker ?? "Meeting audio"}>{props.activeSpeaker ?? "Meeting audio"}</strong></div>
    <div className="player-controls">
      <button className="skip-button" aria-label="Skip back 10 seconds" onClick={() => props.onSkip(-10)}><span aria-hidden="true">↶</span><small>10</small></button>
      <button className="play-button" aria-label={props.playing ? "Pause recording" : "Play recording"} onClick={props.onToggle}><span aria-hidden="true">{props.playing ? "Ⅱ" : "▶"}</span></button>
      <button className="skip-button" aria-label="Skip forward 10 seconds" onClick={() => props.onSkip(10)}><small>10</small><span aria-hidden="true">↷</span></button>
    </div>
    <div className="waveform">
      <input aria-label="Recording position" type="range" min="0" max={Math.max(1, props.durationMs)} value={Math.min(props.currentMs, Math.max(1, props.durationMs))} onChange={(event) => props.onSeek(Number(event.target.value))}/>
      <div className="timeline-time" aria-hidden="true"><span>{formatMs(props.currentMs)}</span><span>{formatMs(props.durationMs)}</span></div>
    </div>
    <div className="player-options">
      <label className="speed-control"><span className="sr-only">Playback speed</span><select aria-label="Playback speed" defaultValue="1" onChange={(event) => props.onRate(Number(event.target.value))}><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>
      <label className="volume-control"><span className="volume-icon" aria-hidden="true">◖</span><input aria-label="Volume" type="range" min="0" max="1" step="0.05" value={props.volume} onChange={(event) => props.onVolume(Number(event.target.value))}/></label>
      <button className="follow-toggle" aria-pressed={props.followTranscript} onClick={props.onFollow}><span aria-hidden="true" />{props.followTranscript ? "Following" : "Follow"}</button>
    </div>
  </section>;
}

function ActionItem({ item, meetingId, segments, onRequest, onSeek }: { item: Action; meetingId: string; segments: Map<string, Segment>; onRequest: (url: string, method: "POST" | "PATCH", body?: unknown) => Promise<boolean>; onSeek: (segment: Segment) => void }) {
  return <form className="action-item" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void onRequest(`/api/meetings/${meetingId}/action-items/${item.id}`, "PATCH", { description: String(data.get("description")), typedOwner: String(data.get("owner") || "") || null, dueDate: String(data.get("dueDate") || "") || null, status: String(data.get("status")) }); }}><label className="action-check"><input type="checkbox" checked={item.status === "COMPLETED"} onChange={(event) => void onRequest(`/api/meetings/${meetingId}/action-items/${item.id}`, "PATCH", { status: event.target.checked ? "COMPLETED" : "OPEN" })}/><span>{item.description}</span></label><div className="action-meta"><span>{item.owner ?? "Unassigned"}</span><span>{item.dueDate ?? "No due date"}</span></div><details><summary>Edit task</summary><label>Task<input name="description" defaultValue={item.description} required/></label><label>Owner<input name="owner" defaultValue={item.owner ?? ""}/></label><label>Due date<input name="dueDate" type="date" defaultValue={item.dueDate ?? ""}/></label><label>Status<select name="status" defaultValue={item.status}><option>OPEN</option><option>IN_PROGRESS</option><option>COMPLETED</option><option>REJECTED</option></select></label><button>Save</button></details><Evidence ids={item.evidence} segments={segments} onSeek={onSeek}/></form>;
}

function SegmentEditor({ segment, speakers, nextSegment, onEdit }: { segment: Segment; speakers: Speaker[]; nextSegment?: Segment; onEdit: (edit: Record<string, unknown>) => Promise<void> }) {
  return <div className="source-segment-editor"><div className="source-segment-heading"><span>{formatMs(segment.startMs)}</span><strong>{segment.speakerName}</strong><span>{segment.text}</span></div><div className="edit-grid"><form onSubmit={(event) => { event.preventDefault(); void onEdit({ action: "edit_text", segmentId: segment.id, text: String(new FormData(event.currentTarget).get("text") ?? "") }); }}><label>Text<textarea name="text" defaultValue={segment.text} required/></label><button>Save text</button></form><label>Speaker<select defaultValue={segment.speakerId ?? ""} onChange={(event) => void onEdit({ action: "reassign", segmentId: segment.id, speakerId: event.target.value || null })}><option value="">Unassigned</option>{speakers.map((speaker) => <option key={speaker.id} value={speaker.id}>{speaker.displayName}</option>)}</select></label><div className="button-row"><button onClick={() => void onEdit({ action: "exclude", segmentId: segment.id, excluded: !segment.excluded })}>{segment.excluded ? "Include in summary" : "Exclude from summary"}</button><button onClick={() => { const at = window.prompt("Split after character number", String(Math.floor(segment.text.length / 2))); if (at) void onEdit({ action: "split", segmentId: segment.id, characterIndex: Number(at) }); }}>Split segment</button>{nextSegment && <button onClick={() => void onEdit({ action: "merge", segmentId: segment.id, nextSegmentId: nextSegment.id })}>Merge with next</button>}</div></div></div>;
}

function PipelineDetails({ processing, onRequest }: { processing: ProcessingSnapshot; onRequest: (url: string, method: "POST" | "PATCH", body?: unknown) => Promise<boolean> }) {
  return <details className="processing-details" open={processing.active}><summary><strong>Local pipeline</strong><span>{processing.job ? `${processing.job.completedStages}/${processing.job.totalStages} stages` : "Not queued"}</span></summary><div className="processing-body"><ol className="stages">{processing.job?.stages.map((stage) => <li key={stage.stage} className={`stage-${stage.state.toLowerCase()}`}><span className="stage-marker" aria-hidden="true"/><span>{humanize(stage.stage)}{stage.progressMessage && <small>{stage.progressMessage}</small>}</span><strong>{humanize(stage.state)}</strong>{stage.state === "FAILED" && <button onClick={() => void onRequest(`/api/jobs/${processing.job?.id}/stages/${stage.stage}/retry`, "POST")}>Retry</button>}{stage.error && <small className="stage-error">{stage.error}</small>}</li>)}</ol></div></details>;
}

function ProcessingStatusCard({ processing, connected, busy, onAction }: { processing: ProcessingSnapshot; connected: boolean; busy: boolean; onAction: (action: "retry" | "cancel") => Promise<void> }) {
  const job = processing.job;
  if (!job || job.state === "COMPLETED") return null;
  const current = job.stages.find((stage) => stage.state === "ACTIVE") ?? job.stages.find((stage) => stage.stage === job.activeStage);
  const tone = job.state === "FAILED" ? "error" : ["CANCELLED", "CANCEL_REQUESTED"].includes(job.state) ? "neutral" : "active";
  const title = processingTitle(processing);
  return <section className={`processing-status processing-status-${tone}`} role="status" aria-live="polite"><div className="processing-status-icon" aria-hidden="true">{processing.active ? <span className="processing-spinner"/> : job.state === "FAILED" ? "!" : "–"}</div><div className="processing-status-copy"><div className="processing-status-heading"><strong>{title}</strong>{processing.active && <span className={`live-indicator ${connected ? "connected" : "reconnecting"}`}><span aria-hidden="true"/>{connected ? "Live" : "Reconnecting"}</span>}</div><p>{current?.progressMessage ?? processingDescription(processing)}</p>{processing.active && <><div className="processing-progress-label"><span>{job.completedStages} of {job.totalStages} stages</span><strong>{job.percent}%</strong></div><progress max="100" value={job.percent} aria-label={`${title}: ${job.percent}%`}/></>}{job.error && <p className="processing-error">{job.error}</p>}</div><div className="processing-status-actions">{processing.active && job.state !== "CANCEL_REQUESTED" && <button disabled={busy} onClick={() => void onAction("cancel")}>Cancel</button>}{["FAILED", "CANCELLED"].includes(job.state) && <button disabled={busy} onClick={() => void onAction("retry")}>Retry</button>}</div></section>;
}

function Evidence({ ids, segments, onSeek }: { ids: string[]; segments: Map<string, Segment>; onSeek: (segment: Segment) => void }) {
  if (!ids.length) return null;
  return <div className="evidence-links"><span>Source</span>{ids.map((id) => { const segment = segments.get(id); return segment ? <button type="button" key={id} title={segment.text} onClick={() => onSeek(segment)}>{formatMs(segment.startMs)}</button> : null; })}</div>;
}

function processingTitle(processing: ProcessingSnapshot) { const job = processing.job; if (!job) return "Not processing"; if (job.state === "QUEUED") return "Queued for local processing"; if (job.state === "FAILED") return "Processing failed"; if (job.state === "CANCELLED") return "Processing cancelled"; if (job.state === "CANCEL_REQUESTED") return "Stopping processing"; return job.activeStage ? humanize(job.activeStage) : "Processing meeting"; }
function processingDescription(processing: ProcessingSnapshot) { const job = processing.job; if (!job) return "No pipeline run"; if (job.state === "QUEUED") return "Waiting for local worker capacity."; if (job.state === "FAILED") return "Review the error, then retry completed checkpoints safely."; return `Attempt ${Math.max(1, job.attempt)} is running locally.`; }
function humanize(value: string) { return value.replaceAll("_", " ").toLowerCase(); }
function formatMs(value: number) { const seconds = Math.floor((Number.isFinite(value) ? value : 0) / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
function truncate(value: string, length: number) { return value.length > length ? `${value.slice(0, length).trim()}…` : value; }
