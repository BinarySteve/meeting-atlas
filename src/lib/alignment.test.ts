import { describe, expect, it } from "vitest";
import { alignWordsToSpeakers, parseDiarization } from "./alignment";

describe("speaker alignment", () => {
  it("rejects malformed model metadata and speaker bounds", () => {
    expect(() => parseDiarization({
      model_digest: "not-a-digest",
      speaker_bounds: { min: 4, max: 2 },
      turns: [],
    })).toThrow();
  });

  it("prefers exclusive turns and leaves weak overlap unassigned", () => {
    const result = alignWordsToSpeakers([
      { text: " Hello", startMs: 100, endMs: 600, sourceSegmentId: "w:0" },
      { text: " there", startMs: 600, endMs: 1000, sourceSegmentId: "w:0" },
      { text: " uncertain", startMs: 1000, endMs: 2000, sourceSegmentId: "w:1" },
    ], { turns: [{ start: 0, end: 2, speaker: "REGULAR" }], exclusive_turns: [{ start: 0, end: 1, speaker: "SPEAKER_00" }, { start: 1, end: 1.2, speaker: "SPEAKER_01" }] });
    expect(result[0].speakerKey).toBe("SPEAKER_00");
    expect(result[0].assignmentReason).toBe("exclusive_overlap");
    expect(result[1].speakerKey).toBeUndefined();
    expect(result[1].assignmentReason).toBe("uncertain");
  });

  it("keeps natural phrases together across low-confidence word boundaries", () => {
    const result = alignWordsToSpeakers([
      { text: " We", startMs: 0, endMs: 400, sourceSegmentId: "w:0" },
      { text: " decided", startMs: 400, endMs: 800, sourceSegmentId: "w:0" },
      { text: " today.", startMs: 800, endMs: 1200, sourceSegmentId: "w:0" },
      { text: " Next", startMs: 1200, endMs: 1600, sourceSegmentId: "w:0" },
      { text: " topic.", startMs: 1600, endMs: 2000, sourceSegmentId: "w:0" },
    ], { turns: [{ start: 0, end: 1.8, speaker: "SPEAKER_00" }] });
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe("We decided today.");
    expect(result[0].speakerKey).toBe("SPEAKER_00");
    expect(result[1].text).toBe("Next topic.");
  });

  it("leaves a phrase unassigned when competing speakers are ambiguous", () => {
    const result = alignWordsToSpeakers([
      { text: " Mixed", startMs: 0, endMs: 500, sourceSegmentId: "w:0" },
      { text: " speech", startMs: 500, endMs: 1000, sourceSegmentId: "w:0" },
    ], { turns: [{ start: 0, end: 1, speaker: "A" }, { start: 0, end: 1, speaker: "B" }] });
    expect(result[0].speakerKey).toBeUndefined();
    expect(result[0].assignmentReason).toBe("overlapping_speech");
  });

  it("uses exclusive timing outside overlap and isolates overlapping words", () => {
    const result = alignWordsToSpeakers([
      { text: " First", startMs: 0, endMs: 800, sourceSegmentId: "w:0" },
      { text: " mixed", startMs: 800, endMs: 1_200, sourceSegmentId: "w:0" },
      { text: " second", startMs: 1_200, endMs: 2_000, sourceSegmentId: "w:0" },
    ], {
      turns: [
        { start: 0, end: 1.2, speaker: "A" },
        { start: 0.8, end: 2, speaker: "B" },
      ],
      exclusive_turns: [
        { start: 0, end: 0.8, speaker: "A" },
        { start: 1.2, end: 2, speaker: "B" },
      ],
    });
    expect(result.map((segment) => segment.speakerKey)).toEqual(["A", undefined, "B"]);
    expect(result.map((segment) => segment.assignmentReason)).toEqual(["exclusive_overlap", "overlapping_speech", "exclusive_overlap"]);
  });

  it("splits a sentence at a confident diarization handoff", () => {
    const result = alignWordsToSpeakers([
      { text: " We", startMs: 0, endMs: 500, sourceSegmentId: "w:0" },
      { text: " agree", startMs: 500, endMs: 1_000, sourceSegmentId: "w:0" },
      { text: " I", startMs: 1_000, endMs: 1_500, sourceSegmentId: "w:0" },
      { text: " disagree.", startMs: 1_500, endMs: 2_000, sourceSegmentId: "w:0" },
    ], { turns: [{ start: 0, end: 1, speaker: "A" }, { start: 1, end: 2, speaker: "B" }] });
    expect(result).toHaveLength(2);
    expect(result.map((segment) => segment.speakerKey)).toEqual(["A", "B"]);
    expect(result.map((segment) => segment.text)).toEqual(["We agree", "I disagree."]);
  });

  it("does not promote a brief isolated speaker flicker", () => {
    const result = alignWordsToSpeakers([
      { text: " We", startMs: 0, endMs: 500, sourceSegmentId: "w:0" },
      { text: " all", startMs: 500, endMs: 700, sourceSegmentId: "w:0" },
      { text: " agree.", startMs: 700, endMs: 1_200, sourceSegmentId: "w:0" },
    ], { turns: [{ start: 0, end: 0.5, speaker: "A" }, { start: 0.5, end: 0.7, speaker: "B" }, { start: 0.7, end: 1.2, speaker: "A" }] });
    expect(result).toHaveLength(1);
    expect(result[0].speakerKey).toBe("A");
  });
});
