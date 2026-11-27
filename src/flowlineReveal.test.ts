import { describe, expect, it } from "vitest";
import { isOpportunityEligible, isPlannableFlowline } from "./flowlineReveal.js";

describe("isOpportunityEligible", () => {
  it("does not require a specialist badge for discovery or routing", () => {
    const plain = { id: "plain", lengthMeters: 4000, flowScore: 82, enduranceScore: 90, exploreScore: 64 };
    expect(isOpportunityEligible(plain)).toBe(true);
    expect(isPlannableFlowline(plain, false)).toBe(true);
  });
  it("requires a good primary score, road quality and data confidence when scored", () => {
    expect(isOpportunityEligible({ id: "x", flowScore: 80 })).toBe(true);
    expect(isOpportunityEligible({ id: "x", flowScore: 40 })).toBe(false);
    expect(isOpportunityEligible({ id: "x", flowScore: 80, roadQualityScore: 30 })).toBe(false);
    expect(isOpportunityEligible({ id: "x", flowScore: 80, dataConfidence: 10 })).toBe(false);
  });

  it("lets routes use eligible or already completed Flowlines", () => {
    expect(isPlannableFlowline({ id: "x", flowScore: 20 }, true)).toBe(true);
    expect(isPlannableFlowline({ id: "x", flowScore: 20 }, false)).toBe(false);
    expect(isPlannableFlowline({ id: "x", flowScore: 80 }, false)).toBe(true);
  });
});
