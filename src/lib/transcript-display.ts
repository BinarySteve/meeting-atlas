export type DisplaySegment = {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  speakerId: string | null;
  speakerName: string;
  assignmentReason?: string | null;
};

export type TranscriptGroup<T extends DisplaySegment> = {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  speakerName: string;
  partiallyUnassigned: boolean;
  containsOverlappingSpeech: boolean;
  segments: T[];
};

export function groupTranscriptSegments<T extends DisplaySegment>(segments: T[]): TranscriptGroup<T>[] {
  const groups: T[][] = [];
  for (const segment of segments) {
    const current = groups.at(-1);
    const previous = current?.at(-1);
    const conflictingSpeakers = Boolean(previous?.speakerId && segment.speakerId && previous.speakerId !== segment.speakerId);
    const startsNewGroup = !current
      || !previous
      || conflictingSpeakers
      || previous.assignmentReason === "overlapping_speech"
      || segment.assignmentReason === "overlapping_speech"
      || segment.startMs - previous.endMs > 1_000
      || segment.endMs - current[0].startMs > 15_000
      || /[.!?]["')\]]?\s*$/.test(previous.text);
    if (startsNewGroup) groups.push([segment]);
    else current.push(segment);
  }
  return groups.map((group) => {
    const assignedNames = [...new Set(group.filter((segment) => segment.speakerId).map((segment) => segment.speakerName))];
    return {
      id: group[0].id,
      startMs: group[0].startMs,
      endMs: group.at(-1)?.endMs ?? group[0].endMs,
      text: joinTranscriptText(group.map((segment) => segment.text)),
      speakerName: assignedNames.length === 0 ? "Unassigned" : assignedNames.length === 1 ? assignedNames[0] : "Multiple speakers",
      partiallyUnassigned: assignedNames.length > 0 && group.some((segment) => !segment.speakerId),
      containsOverlappingSpeech: group.some((segment) => segment.assignmentReason === "overlapping_speech"),
      segments: group,
    };
  });
}

function joinTranscriptText(parts: string[]): string {
  return parts.join(" ").replace(/\s+/g, " ").replace(/\s+([,.;!?])/g, "$1").trim();
}
