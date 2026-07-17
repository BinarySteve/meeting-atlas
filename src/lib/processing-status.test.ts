import { describe, expect, it } from "vitest";
import { calculateProcessingPercent } from "./processing-status";

describe("pipeline progress", () => {
  it("combines completed stages with durable within-stage progress", () => {
    expect(calculateProcessingPercent(1, 3, 2, 4, "ACTIVE")).toBe(50);
  });

  it("reports terminal completion exactly", () => {
    expect(calculateProcessingPercent(2, 3, null, null, "COMPLETED")).toBe(100);
  });

  it("bounds malformed progress", () => {
    expect(calculateProcessingPercent(0, 3, 9, 2, "ACTIVE")).toBe(33);
  });
});
