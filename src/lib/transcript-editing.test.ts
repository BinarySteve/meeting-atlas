import { describe, expect, it } from "vitest";
import type { TranscriptSegment } from "@prisma/client";
import { applyTranscriptEdit } from "./transcript-editing";

const segment = (id: string, ordinal: number, text: string, startMs: bigint): TranscriptSegment => ({
  id,
  transcriptVersionId: "version",
  speakerId: "speaker",
  ordinal,
  startMs,
  endMs: startMs + BigInt(1_000),
  text,
  confidence: 0.9,
  assignmentConfidence: 0.9,
  assignmentReason: "regular_overlap",
  excludedFromSummary: false,
  sourceSegmentIds: [id],
});

describe("applyTranscriptEdit", () => {
  it("splits without losing timing or source evidence", () => {
    const result = applyTranscriptEdit([segment("one", 0, "hello world", BigInt(0))], {
      action: "split",
      segmentId: "one",
      characterIndex: 5,
      splitMs: 400,
    });
    expect(result.map((item) => [item.text, item.startMs, item.endMs])).toEqual([
      ["hello", BigInt(0), BigInt(400)],
      ["world", BigInt(400), BigInt(1_000)],
    ]);
  });

  it("merges only compatible adjacent segments", () => {
    const result = applyTranscriptEdit(
      [segment("one", 0, "hello", BigInt(0)), segment("two", 1, "world", BigInt(1_100))],
      { action: "merge", segmentId: "one", nextSegmentId: "two" },
    );
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("hello world");
    expect(result[0].sourceSegmentIds).toEqual(["one", "two"]);
  });
});
