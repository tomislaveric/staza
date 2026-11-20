import { describe, expect, it } from "vitest";
import { exploreAllowed, exploreOutcome, flowlineAreaStatus, isRevealEligible, selectFlowlinesToReveal } from "./flowlineReveal.js";

const bounds = (widthDegrees: number) => ({ minLatitude: 47, maxLatitude: 47.2, minLongitude: 9, maxLongitude: 9 + widthDegrees });

describe("selectFlowlinesToReveal", () => {
  const candidates = [
    { id: "c", flowScore: 70 },
    { id: "a", flowScore: 90 },
    { id: "b", flowScore: 60, enduranceScore: 90 },
    { id: "d", flowScore: 30 },
    { id: "e", flowScore: 95 },
    { id: "f", flowScore: 99, roadQualityScore: 20 }
  ];

  it("reveals eligible unrevealed Flowlines by primary score, ties by id, up to the cap", () => {
    expect(selectFlowlinesToReveal(candidates, new Set(["e"])).map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(selectFlowlinesToReveal(candidates, new Set(), 2).map((item) => item.id)).toEqual(["e", "a"]);
  });

  it("reveals nothing once every eligible Flowline is known", () => {
    expect(selectFlowlinesToReveal(candidates, new Set(["a", "b", "c", "e"]))).toEqual([]);
  });
});

describe("isRevealEligible", () => {
  it("requires a good primary score, road quality and data confidence when scored", () => {
    expect(isRevealEligible({ id: "x", flowScore: 80 })).toBe(true);
    expect(isRevealEligible({ id: "x", flowScore: 40 })).toBe(false);
    expect(isRevealEligible({ id: "x", flowScore: 80, roadQualityScore: 30 })).toBe(false);
    expect(isRevealEligible({ id: "x", flowScore: 80, dataConfidence: 10 })).toBe(false);
  });
});

describe("area status", () => {
  it("counts eligible hidden Flowlines and blocks wide viewports", () => {
    expect(flowlineAreaStatus(bounds(0.2), 3, [{ id: "a", flowScore: 80 }, { id: "b", flowScore: 10 }]))
      .toEqual({ exploreAllowed: true, knownFlowlines: 3, availableFlowlines: 1 });
    expect(exploreAllowed(bounds(2))).toBe(false);
  });

  it("derives the Explore outcome from known and newly revealed counts", () => {
    expect(exploreOutcome(0, 4)).toBe("discovered");
    expect(exploreOutcome(3, 2)).toBe("already_explored_new");
    expect(exploreOutcome(3, 0)).toBe("already_explored");
    expect(exploreOutcome(0, 0)).toBe("nothing_new");
  });
});
