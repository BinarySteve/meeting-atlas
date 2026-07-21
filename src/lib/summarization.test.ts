import { describe, expect, it } from "vitest";
import { discardUnsupportedEvidence, meetingOutputSchema, sectionTranscript, validateEvidence } from "./summarization";

describe("hierarchical summary safeguards", () => {
  it("chunks on segment boundaries", () => {
    const base = { transcriptVersionId: "v", speakerId: null, confidence: null, assignmentConfidence: null, assignmentReason: null, excludedFromSummary: false, sourceSegmentIds: [] };
    const sections = sectionTranscript([{ ...base, id: "a", ordinal: 0, startMs: BigInt(0), endMs: BigInt(1000), text: "first" }, { ...base, id: "b", ordinal: 1, startMs: BigInt(1000), endMs: BigInt(2000), text: "second" }], 30);
    expect(sections).toHaveLength(2);
  });
  it("rejects invented evidence IDs", () => {
    const output = meetingOutputSchema.parse({ summary: "", decisions: [{ text: "x", evidenceSegmentIds: ["invented"], confidence: 0.5 }], actionItems: [], openQuestions: [], importantClaims: [] });
    expect(() => validateEvidence(output, new Set(["real"]))).toThrow("unknown evidence");
  });
  it("filters unsupported IDs without inventing replacements", () => {
    const output = meetingOutputSchema.parse({
      summary: "",
      decisions: [
        { text: "drop", evidenceSegmentIds: ["invented"], confidence: 0.5 },
        { text: "keep", evidenceSegmentIds: ["real", "invented"], confidence: 0.8 },
      ],
      actionItems: [],
      openQuestions: [],
      importantClaims: [],
    });
    expect(discardUnsupportedEvidence(output, new Set(["real"])).decisions).toEqual([
      { text: "keep", evidenceSegmentIds: ["real"], confidence: 0.8 },
    ]);
  });
});
