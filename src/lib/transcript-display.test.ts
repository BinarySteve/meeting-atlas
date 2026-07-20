import { describe, expect, it } from "vitest";
import { groupTranscriptSegments, type DisplaySegment } from "./transcript-display";

const segment = (overrides: Partial<DisplaySegment>): DisplaySegment => ({ id: "a", startMs: 0, endMs: 500, text: "Hello", speakerId: "speaker", speakerName: "Speaker 1", ...overrides });

describe("compact transcript display", () => {
  it("combines fragments into readable sentences while preserving source segments", () => {
    const groups = groupTranscriptSegments([
      segment({ id: "a", text: "We decided", endMs: 500 }),
      segment({ id: "b", text: "to ship.", startMs: 500, endMs: 1_000, speakerId: null, speakerName: "Unassigned" }),
      segment({ id: "c", text: "Next topic.", startMs: 1_000, endMs: 1_500 }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].text).toBe("We decided to ship.");
    expect(groups[0].partiallyUnassigned).toBe(true);
    expect(groups[0].containsOverlappingSpeech).toBe(false);
    expect(groups[0].segments.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("keeps overlapping speech separate and visible", () => {
    const groups = groupTranscriptSegments([
      segment({ id: "a", text: "Normal", endMs: 500 }),
      segment({ id: "b", text: "Mixed", startMs: 500, assignmentReason: "overlapping_speech", speakerId: null, speakerName: "Unassigned" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[1].containsOverlappingSpeech).toBe(true);
  });

  it("does not combine explicit competing speakers", () => {
    const groups = groupTranscriptSegments([
      segment({ id: "a", speakerId: "one", speakerName: "Speaker 1" }),
      segment({ id: "b", startMs: 500, speakerId: "two", speakerName: "Speaker 2" }),
    ]);
    expect(groups).toHaveLength(2);
  });
});
