import { describe, expect, it } from "vitest";
import { renderExport } from "./exports";

describe("renderExport", () => {
  it("renders speaker labels and exact SRT timing", () => {
    const meeting = {
      id: "meeting", title: "Test", recordingDate: null, state: "COMPLETED", activeStage: null, activeSummaryVersionId: null, retentionUntil: null, protectedFromRetention: false, createdAt: new Date(0), updatedAt: new Date(0),
      recordings: [], speakers: [], summaries: [], actionItems: [], decisions: [], openQuestions: [],
      transcriptVersions: [{ id: "version", meetingId: "meeting", version: 1, source: "MACHINE", parentId: null, createdAt: new Date(0), segments: [{ id: "segment", transcriptVersionId: "version", speakerId: "speaker", ordinal: 0, startMs: BigInt(1_234), endMs: BigInt(3_456), text: "Hello", confidence: null, assignmentConfidence: null, assignmentReason: null, excludedFromSummary: false, sourceSegmentIds: [], speaker: { id: "speaker", meetingId: "meeting", diarizationKey: "key", displayName: "Speaker 1", createdAt: new Date(0) } }] }],
    };
    expect(renderExport(meeting as never, "srt")).toContain("00:00:01,234 --> 00:00:03,456\nSpeaker 1: Hello");
  });
});
