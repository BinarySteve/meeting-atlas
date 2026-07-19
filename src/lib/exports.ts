import type { Prisma } from "@prisma/client";

export const EXPORT_FORMATS = ["txt", "md", "json", "srt", "vtt"] as const;
export type ExportFormat = typeof EXPORT_FORMATS[number];

type ExportMeeting = Prisma.MeetingGetPayload<{
  include: {
    recordings: true;
    speakers: true;
    transcriptVersions: { include: { segments: { include: { speaker: true } } } };
    summaries: { include: { sections: true } };
    actionItems: true;
    decisions: true;
    openQuestions: true;
  };
}>;

export function renderExport(meeting: ExportMeeting, format: ExportFormat): string {
  const transcript = meeting.transcriptVersions.find((version) => version.id === meeting.activeTranscriptVersionId)
    ?? [...meeting.transcriptVersions].sort((a, b) => b.version - a.version)[0];
  const segments = transcript ? [...transcript.segments].sort((a, b) => a.ordinal - b.ordinal) : [];
  if (format === "json") return JSON.stringify(jsonSafe(meeting), null, 2);
  if (format === "srt") return segments.map((segment, index) => `${index + 1}\n${subtitleTime(segment.startMs, ",")} --> ${subtitleTime(segment.endMs, ",")}\n${segment.speaker?.displayName ?? "Unassigned"}: ${segment.text}\n`).join("\n");
  if (format === "vtt") return `WEBVTT\n\n${segments.map((segment) => `${subtitleTime(segment.startMs, ".")} --> ${subtitleTime(segment.endMs, ".")}\n${segment.speaker?.displayName ?? "Unassigned"}: ${segment.text}\n`).join("\n")}`;
  const lines = segments.map((segment) => `[${displayTime(segment.startMs)}] ${segment.speaker?.displayName ?? "Unassigned"}: ${segment.text}`);
  if (format === "txt") return `${meeting.title}\n\n${lines.join("\n")}\n`;
  return `# ${meeting.title}\n\n## Transcript\n\n${lines.join("\n\n")}\n`;
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  return value;
}

function displayTime(value: bigint): string {
  const total = Math.floor(Number(value) / 1_000);
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function subtitleTime(value: bigint, separator: "," | "."): string {
  const milliseconds = Number(value);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = milliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${separator}${String(millis).padStart(3, "0")}`;
}
