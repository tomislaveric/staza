import { describe, expect, it } from "vitest";
import {
  exploreAllowed,
  exploreOutcome,
  isOpportunityEligible,
  isPlannableFlowline,
  selectFlowlineOpportunities
} from "./flowlineReveal.js";

const bounds = (widthDegrees: number) => ({ minLatitude: 47, maxLatitude: 47.2, minLongitude: 9, maxLongitude: 9 + widthDegrees });

describe("selectFlowlineOpportunities", () => {
  const candidates = [
    { id: "c", flowScore: 70 },
    { id: "a", flowScore: 90 },
    { id: "b", flowScore: 60, enduranceScore: 90 },
    { id: "d", flowScore: 30 },
    { id: "e", flowScore: 95 },
    { id: "f", flowScore: 99, roadQualityScore: 20 }
  ];

  it("selects eligible Flowlines except excluded ones by primary score, ties by id, up to the cap", () => {
    expect(selectFlowlineOpportunities(candidates, new Set(["e"])).map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(selectFlowlineOpportunities(candidates, new Set(), 2).map((item) => item.id)).toEqual(["e", "a"]);
  });

  it("is stable: the same area always yields the same opportunities", () => {
    expect(selectFlowlineOpportunities(candidates, new Set())).toEqual(selectFlowlineOpportunities([...candidates].reverse(), new Set()));
  });
});

describe("isOpportunityEligible", () => {
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

describe("area status", () => {
  it("flags viewports wider than one Explore", () => {
    expect(exploreAllowed(bounds(0.2))).toBe(true);
    expect(exploreAllowed(bounds(2))).toBe(false);
  });

  it("derives the Explore outcome from the opportunity count", () => {
    expect(exploreOutcome(4)).toBe("discovered");
    expect(exploreOutcome(0)).toBe("nothing_new");
  });
});
