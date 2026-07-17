import { MeetingState } from "@prisma/client";
import Form from "next/form";
import Link from "next/link";
import { z } from "zod";
import { FormSubmitButton } from "@/app/form-submit-button";
import { MeetingDeleteButton } from "@/app/meeting-delete-button";
import { requireUserId } from "@/lib/auth";
import { searchMeetings } from "@/lib/meeting-search";

const searchSchema = z.object({
  q: z.string().max(500).optional(), speaker: z.string().max(200).optional(),
  state: z.nativeEnum(MeetingState).optional().or(z.literal("")),
  uploadedFrom: z.string().date().optional().or(z.literal("")), uploadedTo: z.string().date().optional().or(z.literal("")),
  recordedFrom: z.string().date().optional().or(z.literal("")), recordedTo: z.string().date().optional().or(z.literal("")),
});

export async function MeetingLibrary({ searchParams, searchMode = false }: { searchParams: Promise<Record<string, string | string[] | undefined>>; searchMode?: boolean }) {
  await requireUserId();
  const raw = searchMode ? await searchParams : {};
  const parsed = searchSchema.safeParse(Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])));
  const filters = parsed.success ? parsed.data : {};
  const activeFilters = [["speaker", filters.speaker], ["state", filters.state], ["uploadedFrom", filters.uploadedFrom], ["uploadedTo", filters.uploadedTo], ["recordedFrom", filters.recordedFrom], ["recordedTo", filters.recordedTo]].filter((entry) => entry[1]);
  const hasSearchCriteria = Boolean(filters.q?.trim() || activeFilters.length);
  const meetings = searchMode && !hasSearchCriteria ? [] : await searchMeetings({ query: filters.q, speaker: filters.speaker, state: filters.state || undefined, uploadedFrom: date(filters.uploadedFrom), uploadedTo: nextDay(filters.uploadedTo), recordedFrom: date(filters.recordedFrom), recordedTo: nextDay(filters.recordedTo) });
  const processing = searchMode ? [] : meetings.filter((meeting) => ["UPLOADING", "QUEUED", "PROCESSING"].includes(meeting.state));
  const route = "/search";
  return <main className="page-shell">
    <header className="page-intro"><div><p className="eyebrow">{searchMode ? "Meeting library" : "Private workspace"}</p><h1>{searchMode ? "Search meetings" : "Your meetings"}</h1><p>{searchMode ? "Find meetings by title, speaker, transcript, summary, decision, or action item." : "Review transcripts, summaries, decisions, and follow-ups. Everything processes on your local system."}</p></div><Link className="button primary desktop-new" href="/meetings/new">+ Record or upload</Link></header>
    {searchMode && <><section className="library-tools" aria-label="Search meetings"><Form action={route} className="search-form" scroll={false}>
      <label className="sr-only" htmlFor="meeting-search">Search meetings</label><input id="meeting-search" name="q" type="search" autoFocus={searchMode} defaultValue={filters.q ?? ""} placeholder="Search meetings, speakers, transcripts…" /><FormSubmitButton className="button secondary">Search</FormSubmitButton>
    </Form><details className="filter-drawer"><summary className="button secondary">Filters {activeFilters.length > 0 && <span className="count">{activeFilters.length}</span>}</summary><Form action={route} className="filter-form" scroll={false}>
      <label>Speaker<input name="speaker" defaultValue={filters.speaker ?? ""} /></label>
      <label>State<select name="state" defaultValue={filters.state ?? ""}><option value="">Any state</option>{Object.values(MeetingState).map((state) => <option key={state}>{state}</option>)}</select></label>
      <label>Uploaded from<input name="uploadedFrom" type="date" defaultValue={filters.uploadedFrom ?? ""} /></label><label>Uploaded to<input name="uploadedTo" type="date" defaultValue={filters.uploadedTo ?? ""} /></label>
      <label>Recorded from<input name="recordedFrom" type="date" defaultValue={filters.recordedFrom ?? ""} /></label><label>Recorded to<input name="recordedTo" type="date" defaultValue={filters.recordedTo ?? ""} /></label>
      <input type="hidden" name="q" value={filters.q ?? ""}/><FormSubmitButton className="button primary" pendingLabel="Applying…">Apply filters</FormSubmitButton><Link className="button secondary" href={filters.q ? `${route}?q=${encodeURIComponent(filters.q)}` : route}>Clear filters</Link>
    </Form></details></section>
    {activeFilters.length > 0 && <div className="filter-chips" aria-label="Active filters">{activeFilters.map(([key, value]) => { const next = new URLSearchParams(Object.entries(filters).filter(([, val]) => val).map(([k, val]) => [k, String(val)])); next.delete(String(key)); return <Link key={String(key)} href={`${route}?${next}`} className="chip">{humanize(String(key))}: {String(value)} <span aria-hidden="true">×</span></Link>; })}</div>}</>}
    {processing.length > 0 && <section><div className="section-heading"><div><p className="eyebrow">IN PROGRESS</p><h2>Processing</h2></div></div><div className="meeting-grid">{processing.map((meeting) => <MeetingCard key={meeting.id} meeting={meeting}/>)}</div></section>}
    <section><div className="section-heading"><div><h2>{searchMode ? (hasSearchCriteria ? "Search results" : "Find a meeting") : "Recent meetings"}</h2>{(!searchMode || hasSearchCriteria) && <p>{meetings.length} {meetings.length === 1 ? "meeting" : "meetings"}</p>}</div><Link className="button primary mobile-new" href="/meetings/new">+ New meeting</Link></div>{meetings.length === 0 ? searchMode && !hasSearchCriteria ? <div className="empty-state"><strong>Search your meeting library</strong><p>Enter a term or choose filters to find a meeting.</p></div> : <div className="empty-state"><strong>No meetings found</strong><p>{searchMode ? "Try another term or clear your filters." : "Add your first recording to start your local meeting library."}</p>{!searchMode && <Link className="button primary" href="/meetings/new">Add recording</Link>}</div> : <div className="meeting-grid">{meetings.map((meeting) => <MeetingCard key={meeting.id} meeting={meeting}/>)}</div>}</section>
  </main>;
}

type SearchMeeting = Awaited<ReturnType<typeof searchMeetings>>[number];
function MeetingCard({ meeting }: { meeting: SearchMeeting }) { const duration = meeting.recordings[0]?.durationMs; return <article className="meeting-card-shell"><Link className="meeting-card" href={`/meetings/${meeting.id}`}><div className="meeting-card-main"><div><span className={`status-badge status-${meeting.state.toLowerCase()}`}><span aria-hidden="true"/>{humanize(meeting.state)}</span><h3>{meeting.title}</h3></div><span aria-hidden="true" className="card-arrow">→</span></div><div className="meeting-meta"><time>{(meeting.recordingDate ?? meeting.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</time>{duration && <span>{formatDuration(Number(duration))}</span>}<span>{meeting.speakers.length} {meeting.speakers.length === 1 ? "speaker" : "speakers"}</span><span>Uploaded audio</span><span>{meeting.summaries.length ? "Summary ready" : "Summary pending"}</span></div>{meeting.speakers.length > 0 && <p>{meeting.speakers.slice(0, 3).map((speaker) => speaker.displayName).join(", ")}</p>}</Link><MeetingDeleteButton className="meeting-card-delete" meetingId={meeting.id} meetingTitle={meeting.title}/></article>; }
function humanize(value: string): string { return value.replaceAll(/([A-Z])/g, " $1").replaceAll("_", " ").trim().toLowerCase(); }
function formatDuration(ms: number): string { const minutes = Math.round(ms / 60_000); return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }
function date(value?: string): Date | undefined { return value ? new Date(`${value}T00:00:00`) : undefined; }
function nextDay(value?: string): Date | undefined { const result = date(value); if (result) result.setDate(result.getDate() + 1); return result; }
