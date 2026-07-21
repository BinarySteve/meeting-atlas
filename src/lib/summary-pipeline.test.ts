import { describe, expect, it, vi } from "vitest";
import { requestValidatedMeetingOutput } from "./summary-pipeline";

const base = { summary: "Summary", decisions: [], actionItems: [], openQuestions: [], importantClaims: [] };

describe("structured summary repair", () => {
  it("repairs an invented evidence ID once using the exact allowlist", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ content: { ...base, decisions: [{ text: "Decision", confidence: 0.8, evidenceSegmentIds: ["invented"] }] } })
      .mockResolvedValueOnce({ content: { ...base, decisions: [{ text: "Decision", confidence: 0.8, evidenceSegmentIds: ["real-segment"] }] } });

    const output = await requestValidatedMeetingOutput(
      "system",
      "[real-segment] source",
      new Set(["real-segment"]),
      new AbortController().signal,
      "request",
      request,
    );

    expect(output.decisions[0].evidenceSegmentIds).toEqual(["real-segment"]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][1].user).toContain('"real-segment"');
    expect(request.mock.calls[1][3]).toBe("request:repair");
  });

  it("does not call repair when first output is valid", async () => {
    const request = vi.fn().mockResolvedValue({ content: base });
    await requestValidatedMeetingOutput("system", "source", new Set(["real"]), new AbortController().signal, "request", request);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("discards unsupported evidence after the bounded repair attempt", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ content: { ...base, decisions: [{ text: "Unsupported", confidence: 0.8, evidenceSegmentIds: ["invented"] }] } })
      .mockResolvedValueOnce({ content: {
        ...base,
        decisions: [{ text: "Unsupported", confidence: 0.8, evidenceSegmentIds: ["invented"] }],
        importantClaims: [{ text: "Supported", confidence: 0.9, evidenceSegmentIds: ["invented", "real-segment"] }],
      } });

    const output = await requestValidatedMeetingOutput(
      "system",
      "[real-segment] source",
      new Set(["real-segment"]),
      new AbortController().signal,
      "request",
      request,
    );

    expect(output.decisions).toEqual([]);
    expect(output.importantClaims[0].evidenceSegmentIds).toEqual(["real-segment"]);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
