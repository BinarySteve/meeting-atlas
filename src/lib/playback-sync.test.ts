import { describe, expect, it } from "vitest";
import { findActiveTimedSegment } from "./playback-sync";

const segments = [
  { id: "first", startMs: 1_000, endMs: 2_000 },
  { id: "second", startMs: 5_000, endMs: 6_000 },
];

describe("playback transcript synchronization", () => {
  it("finds exact half-open transcript intervals", () => {
    expect(findActiveTimedSegment(segments, 1_000)?.id).toBe("first");
    expect(findActiveTimedSegment(segments, 1_999)?.id).toBe("first");
    expect(findActiveTimedSegment(segments, 2_000)).toBeUndefined();
    expect(findActiveTimedSegment(segments, 5_000)?.id).toBe("second");
  });

  it("keeps real silence unassigned", () => {
    expect(findActiveTimedSegment(segments, 0)).toBeUndefined();
    expect(findActiveTimedSegment(segments, 3_000)).toBeUndefined();
    expect(findActiveTimedSegment(segments, 6_000)).toBeUndefined();
  });
});
