# Meeting Atlas workspace design system

## Design audit

Before redesign, Meeting Atlas already had working authentication, streaming uploads, Postgres-backed meeting search, local processing status, transcript editing, audio playback, speaker renaming, summary versioning, action-item editing, evidence links, exports, retention, passkeys, and PWA metadata. Presentation used a green, dark-mode-aware theme with a sticky top bar and mostly stacked cards. Meeting detail separated transcript and outcomes into page-level modes, preventing the transcript, meeting intelligence, and audio from reading as one workspace.

Redesign keeps those contracts and makes transcript review the visual center. Desktop now follows the supplied reference: narrow navigation, compact meeting header, timeline rail, transcript column, contextual insights panel, and attached audio controls. Mobile uses explicit Transcript, Summary, Actions, and Details modes plus persistent bottom navigation and audio controls.

## Route map

- `/` — recent meeting library, processing list, and summary availability
- `/search` — focused meeting search with URL-backed query and filters; results appear after search criteria are entered
- `/meetings/new` — upload-first new meeting flow; browser recording visibly unavailable until backend support exists
- `/meetings/[id]` — transcript-centered meeting workspace
- `/meetings/[id]?view=transcript|summary|actions|details` — mobile workspace modes
- `/account` — account and passkey security
- `/login` and `/offline` — authentication and offline fallback

## Component map

- `AppShell`, desktop `Sidebar`, and `MobileNavigation`
- meeting library card, status badge, search and filter controls
- `UploadForm`, drop zone, upload progress, processing-default disclosure
- `MeetingWorkspace`, `TimelinePanel`, transcript search, transcript segment/editor, transcript version history/activation
- insight tabs, summary, key points, action items, decisions, questions, topic placeholder
- local processing status and pipeline details
- synchronized audio player with seek, skip, speed, volume, and transcript follow
- export, retention, speaker management, audit history, empty/error/loading states

## Tokens

Tokens live in `src/app/globals.css`; components must use variables instead of isolated color, radius, or spacing values.

### Color

- Canvas: `#f7f8fc`
- Surface: `#ffffff`
- Soft surface: `#f4f6fb`
- Primary text: `#151b36`
- Secondary text: `#5f677d`
- Muted text: `#8b93a7`
- Border: `#e3e7ef`
- Primary blue: `#315efb`; hover `#244bdd`; soft `#edf2ff`
- Secondary violet: `#6846f3`
- Success: `#168569`; warning: `#a15c05`; danger: `#c63e4d`

Blue marks selection, playback, focus, and primary actions. Violet labels meeting intelligence. Semantic colors always pair with text, icons, labels, or shapes.

### Typography

Inter is preferred, with system sans-serif fallback. App headings use 22–36 px responsive sizes, not marketing-scale display type. Body is 16 px; labels and metadata use 12–14 px with maintained contrast.

### Spacing and shape

Base spacing steps: 4, 8, 12, 16, 20, 24, and 32 px. Controls are at least 44 px high on touch layouts. Radiuses are 8, 12, and 16 px; pill radius is reserved for chips. Shadows are restrained and used for raised players, menus, and upload surfaces.

## Responsive behavior

- Under 1024 px: bottom navigation, single selected meeting mode, full-width transcript/insights, sticky audio player above safe-area navigation.
- 768 px and above: wider forms, three-column transcript rows, two-column detail utilities.
- 1024 px and above: 240–248 px sidebar, timeline/transcript/insights workspace, audio player attached to workspace bottom.
- 1280 px and above: more transcript space while keeping insights near 368 px.

All fixed bottom UI includes `env(safe-area-inset-bottom)`. Reduced-motion preferences disable nonessential animation and smooth scrolling.

## Transcript and processing states

Current playback uses pale blue fill plus an inset blue rule. Speaker identity pairs a name with a colored dot. Timestamps are buttons and seek audio. Follow mode highlights only a segment whose half-open `[start, end)` interval contains the current playback position; silence gaps have no false highlight. Reduced-motion users get immediate rather than smooth follow scrolling. Editing stays behind a disclosure to preserve reading focus.

Processing supports uploading, queued, active pipeline stages, retrying, cancellation requested, completed, failed, and cancelled. Status uses text plus a marker/spinner and progress, never color alone. All processing controls adopt local submitting state immediately and remain disabled while the PostgreSQL/SSE snapshot is active. Transcript Details exposes machine-version reprocessing and compact version history; manual versions show why reprocessing is protected and allow explicit activation of an older machine version. Complete meetings omit the transient processing banner.

## Accessibility

Landmarks, labeled navigation, tab semantics, status live regions, screen-reader labels, visible focus rings, keyboard-operable controls, semantic forms, and minimum touch target sizes are used. Transcript timestamps, evidence timestamps, player controls, and status actions have explicit labels. Motion honors `prefers-reduced-motion`.

## Backend contract gaps

- Browser live recording is not connected and is labeled “Coming soon.”
- Language, model, diarization, expected speaker count, and summary options currently use worker-level defaults. Disabled controls disclose this instead of implying per-meeting persistence.
- Topic and notes extraction/storage are not present. Topics panel states this; no fabricated topics or notes are shown.
- Participant identity beyond diarized speakers is unavailable.
