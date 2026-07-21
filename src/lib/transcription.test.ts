import { describe, expect, it } from "vitest";
import { assembleWhisperCppResponse, extractWhisperWords } from "./transcription";

describe("whisper.cpp transcript assembly", () => {
  it("preserves offsets, strips control tokens, and averages confidence", () => {
    const segments = assembleWhisperCppResponse({ timeline: { basis: "normalized_audio", unit: "milliseconds", duration_ms: 11_000, speech_gaps_preserved: true }, raw: { transcription: [{ offsets: { from: 320, to: 10370 }, text: "[_BEG_] Hello world[_TT_410]", tokens: [{ text: "[_BEG_]", offsets: { from: 0, to: 0 }, p: 0.99 }, { text: " Hello", offsets: { from: 320, to: 700 }, p: 0.8 }, { text: " world", offsets: { from: 700, to: 1000 }, p: 0.6 }] }] } });
    expect(segments).toEqual([{ ordinal: 0, startMs: BigInt(320), endMs: BigInt(10370), text: "Hello world", confidence: 0.7, sourceSegmentIds: ["whisper:0"] }]);
  });

  it("rejects malformed service output", () => {
    expect(() => assembleWhisperCppResponse({ raw: {} })).toThrow();
  });

  it("keeps zero-duration decoder artifacts out of derived transcript data", () => {
    const response = {
      timeline: { basis: "normalized_audio", unit: "milliseconds", duration_ms: 1_000, speech_gaps_preserved: true },
      raw: {
        transcription: [{
          offsets: { from: 580, to: 580 },
          text: " decoder artifact",
          tokens: [{ text: " decoder artifact", offsets: { from: 580, to: 580 }, p: 0.5 }],
        }],
      },
    };

    expect(extractWhisperWords(response)).toEqual([]);
    expect(assembleWhisperCppResponse(response)).toEqual([]);
  });
});
