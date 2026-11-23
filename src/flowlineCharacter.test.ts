import { describe, expect, it } from "vitest";
import { classifyFlowline, opportunityScore } from "./flowlineCharacter.js";

describe("classifyFlowline", () => {
  it.each([
    [82, 4999.99, null],
    [82.01, 4999.99, "flow"],
    [100, 5000, null],
    [100, 5000.01, null]
  ])("uses raw Flow %s and length %s at the strict boundaries", (flowScore, lengthMeters, primary) => {
    expect(classifyFlowline({ flowScore, lengthMeters })).toEqual({
      primary, tags: primary ? [primary] : [], policyVersion: 2
    });
  });

  it("uses length and ordered qualification, not the highest score", () => {
    expect(classifyFlowline({ lengthMeters: 4000, flowScore: 83, enduranceScore: 100, exploreScore: 100 }).primary).toBe("flow");
    expect(classifyFlowline({ lengthMeters: 5000, flowScore: 100, enduranceScore: 65, exploreScore: 100 }).primary).toBe("endurance");
    expect(classifyFlowline({ lengthMeters: 5000, flowScore: 100, enduranceScore: 64, exploreScore: 65 }).primary).toBe("explore");
    expect(classifyFlowline({ lengthMeters: 4000, enduranceScore: 100, exploreScore: 64 }).primary).toBeNull();
  });

  it.each([undefined, 0, -1, NaN, Infinity])("does not invent length-based characters for %s", (lengthMeters) => {
    expect(classifyFlowline({ lengthMeters, flowScore: 100, enduranceScore: 100 }).primary).toBeNull();
    expect(classifyFlowline({ lengthMeters, exploreScore: 65 }).primary).toBe("explore");
  });

  it.each([undefined, NaN, Infinity, -1, 101])("ignores invalid/missing scores (%s)", (score) => {
    expect(classifyFlowline({ lengthMeters: 3000, flowScore: score }).primary).toBeNull();
    expect(classifyFlowline({ lengthMeters: 6000, enduranceScore: score, exploreScore: score }).primary).toBeNull();
  });

  it("keeps plain Flowlines eligible for score-based ranking without a specialist badge", () => {
    expect(classifyFlowline({ lengthMeters: 4000, flowScore: 82, enduranceScore: 90, exploreScore: 60 }).primary).toBeNull();
    expect(opportunityScore({ lengthMeters: 4000, flowScore: 82, enduranceScore: 90, exploreScore: 60 })).toBe(90);
    expect(opportunityScore({})).toBe(0);
    expect(opportunityScore({ flowScore: NaN, enduranceScore: 75 })).toBe(75);
  });

  it("preserves historical ranking when a lower score alone meets its old threshold", () => {
    expect(opportunityScore({ flowScore: 69, enduranceScore: 65 })).toBe(65);
    expect(opportunityScore({ flowScore: 69, enduranceScore: 64 })).toBe(69);
  });
});
