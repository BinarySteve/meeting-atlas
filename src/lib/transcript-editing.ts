import type { Prisma, TranscriptSegment } from "@prisma/client";
import { db } from "./db";
import { writeAudit } from "./audit";

export type TranscriptEdit =
  | { action: "edit_text"; segmentId: string; text: string }
  | { action: "reassign"; segmentId: string; speakerId: string | null }
  | { action: "exclude"; segmentId: string; excluded: boolean }
  | { action: "split"; segmentId: string; characterIndex: number; splitMs?: number }
  | { action: "merge"; segmentId: string; nextSegmentId: string };

type SegmentDraft = Omit<TranscriptSegment, "id" | "transcriptVersionId">;

export function applyTranscriptEdit(
  source: TranscriptSegment[],
  edit: TranscriptEdit,
): SegmentDraft[] {
  const segments: SegmentDraft[] = source
    .sort((left, right) => left.ordinal - right.ordinal)
    .map(toDraft);
  const sourceIndex = source.findIndex((segment) => segment.id === edit.segmentId);
  if (sourceIndex < 0) throw new Error("Transcript segment not found");

  if (edit.action === "edit_text") {
    const text = edit.text.trim();
    if (!text) throw new Error("Transcript text cannot be empty");
    segments[sourceIndex].text = text;
  } else if (edit.action === "reassign") {
    segments[sourceIndex].speakerId = edit.speakerId;
    segments[sourceIndex].assignmentReason = "manual";
    segments[sourceIndex].assignmentConfidence = 1;
  } else if (edit.action === "exclude") {
    segments[sourceIndex].excludedFromSummary = edit.excluded;
  } else if (edit.action === "split") {
    const segment = segments[sourceIndex];
    if (edit.characterIndex <= 0 || edit.characterIndex >= segment.text.length) {
      throw new Error("Split position must be inside transcript text");
    }
    const leftText = segment.text.slice(0, edit.characterIndex).trim();
    const rightText = segment.text.slice(edit.characterIndex).trim();
    if (!leftText || !rightText) throw new Error("Split must produce two non-empty segments");
    const requestedMs = edit.splitMs === undefined ? undefined : BigInt(edit.splitMs);
    const midpoint = requestedMs ?? segment.startMs + (segment.endMs - segment.startMs) / BigInt(2);
    if (midpoint <= segment.startMs || midpoint >= segment.endMs) {
      throw new Error("Split timestamp must be inside segment timing");
    }
    segments.splice(
      sourceIndex,
      1,
      { ...segment, text: leftText, endMs: midpoint },
      { ...segment, text: rightText, startMs: midpoint },
    );
  } else {
    const nextIndex = source.findIndex((segment) => segment.id === edit.nextSegmentId);
    if (nextIndex !== sourceIndex + 1) throw new Error("Only adjacent segments can be merged");
    const current = segments[sourceIndex];
    const next = segments[nextIndex];
    if (current.speakerId !== next.speakerId) throw new Error("Segments must have same speaker");
    if (current.excludedFromSummary !== next.excludedFromSummary) {
      throw new Error("Segments must have same summary inclusion state");
    }
    if (next.startMs - current.endMs > BigInt(5_000)) throw new Error("Segments are too far apart");
    segments.splice(sourceIndex, 2, {
      ...current,
      endMs: next.endMs,
      text: `${current.text.trim()} ${next.text.trim()}`,
      confidence: average(current.confidence, next.confidence),
      assignmentConfidence: Math.min(
        current.assignmentConfidence ?? 0,
        next.assignmentConfidence ?? 0,
      ),
      sourceSegmentIds: [...new Set([...current.sourceSegmentIds, ...next.sourceSegmentIds])],
    });
  }

  return segments.map((segment, ordinal) => ({ ...segment, ordinal }));
}

export async function createEditedTranscriptVersion(input: {
  meetingId: string;
  baseVersionId: string;
  userId: string;
  edit: TranscriptEdit;
}): Promise<{ id: string; version: number }> {
  return db.$transaction(async (tx) => {
    const base = await tx.transcriptVersion.findFirst({
      where: { id: input.baseVersionId, meetingId: input.meetingId },
      include: { segments: { orderBy: { ordinal: "asc" } } },
    });
    if (!base) throw new Error("Transcript version not found");
    if (input.edit.action === "reassign" && input.edit.speakerId) {
      const speaker = await tx.speaker.findFirst({
        where: { id: input.edit.speakerId, meetingId: input.meetingId },
        select: { id: true },
      });
      if (!speaker) throw new Error("Speaker not found in meeting");
    }
    const drafts = applyTranscriptEdit(base.segments, input.edit);
    const latest = await tx.transcriptVersion.aggregate({
      where: { meetingId: input.meetingId },
      _max: { version: true },
    });
    const versionNumber = (latest._max.version ?? 0) + 1;
    const version = await tx.transcriptVersion.create({
      data: {
        meetingId: input.meetingId,
        version: versionNumber,
        source: "MANUAL",
        parentId: base.id,
        segments: {
          createMany: {
            data: drafts.map((segment) => ({ ...segment })),
          },
        },
      },
    });
    await tx.meeting.update({
      where: { id: input.meetingId },
      data: { activeSummaryVersionId: null },
    });
    await writeAudit(tx, {
      userId: input.userId,
      meetingId: input.meetingId,
      action: `transcript.${input.edit.action}`,
      entityType: "TranscriptVersion",
      entityId: version.id,
      metadata: {
        baseVersionId: base.id,
        newVersion: versionNumber,
        segmentId: input.edit.segmentId,
      } satisfies Prisma.InputJsonValue,
    });
    return { id: version.id, version: version.version };
  });
}

function average(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return (left + right) / 2;
}

function toDraft(segment: TranscriptSegment): SegmentDraft {
  return {
    speakerId: segment.speakerId,
    ordinal: segment.ordinal,
    startMs: segment.startMs,
    endMs: segment.endMs,
    text: segment.text,
    confidence: segment.confidence,
    assignmentConfidence: segment.assignmentConfidence,
    assignmentReason: segment.assignmentReason,
    excludedFromSummary: segment.excludedFromSummary,
    sourceSegmentIds: segment.sourceSegmentIds,
  };
}
