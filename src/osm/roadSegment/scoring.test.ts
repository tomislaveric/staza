import { describe, expect, it } from "vitest";
import type { FartlekCandidate } from "../fartlekModel.js";
import {
  scoreEndurance,
  scoreExplore,
  scoreRoadQuality,
  scoreRoadCyclingSegment,
  SEGMENT_SCORING_VERSION
} from "./scoring.js";
import { extractRoadCyclingSegmentFeatures } from "./features.js";
import { evaluateRoadCyclingEligibility } from "./eligibility.js";
import { calculateRoadCyclingFlowlineQuality } from "../roadCyclingFlowlineQuality.js";

const candidate = (tags: Record<string, string>[], overrides: Partial<FartlekCandidate> = {}): FartlekCandidate => ({
  id: "segment-test",
  name: "Rural Road",
  coordinates: [[8, 48], [8.04, 48]],
  lengthMeters: 3_000,
  sourceWayIds: ["way-1"],
  candidateGenerationVersion: "test-v1",
  junctionCount: 1,
  trafficControlCount: 0,
  tagsBySegment: tags,
  hasClearBoundaries: true,
  mostlyNonUrban: true,
  ...overrides
});

describe("segment scoring model", () => {
  it("pins the integer scoring version", () => {
    expect(SEGMENT_SCORING_VERSION).toBe(1);
  });

  it("zeros every style score for an ineligible (bicycle-forbidden) segment", () => {
    const c = candidate([{ highway: "secondary", surface: "asphalt", bicycle: "no" }]);
    expect(evaluateRoadCyclingEligibility(c).eligible).toBe(false);
    const features = extractRoadCyclingSegmentFeatures(c);
    expect(scoreEndurance(features)).toBe(0);
    expect(scoreExplore(features)).toBe(0);
    expect(scoreRoadQuality(features)).toBe(0);
    const scores = scoreRoadCyclingSegment(c, calculateRoadCyclingFlowlineQuality(c));
    expect(scores.flow).toBe(0);
  });

  it("produces independent, non-identical style scores for an eligible segment", () => {
    const c = candidate([{ highway: "secondary", surface: "asphalt", maxspeed: "70", bicycle: "yes" }]);
    const scores = scoreRoadCyclingSegment(c, calculateRoadCyclingFlowlineQuality(c));
    expect(scores.flow).toBeGreaterThan(0);
    expect(scores.endurance).toBeGreaterThan(0);
    expect(scores.explore).toBeGreaterThan(0);
    expect(scores.roadQuality).toBeGreaterThan(0);
    // The four style scores are not mere copies of one another.
    expect(new Set([scores.flow, scores.endurance, scores.explore, scores.roadQuality]).size)
      .toBeGreaterThan(1);
    expect(scores.dataConfidence).toBeGreaterThan(0);
    expect(scores.dataConfidence).toBeLessThanOrEqual(1);
  });

  it("rewards a longer continuous rural road with a higher endurance score", () => {
    const shortRoad = candidate([{ highway: "secondary", surface: "asphalt" }], { lengthMeters: 1_200 });
    const longRoad = candidate([{ highway: "secondary", surface: "asphalt" }], { lengthMeters: 12_000 });
    expect(scoreEndurance(extractRoadCyclingSegmentFeatures(longRoad)))
      .toBeGreaterThan(scoreEndurance(extractRoadCyclingSegmentFeatures(shortRoad)));
  });

  it("rewards non-urban rural evidence with a higher explore score", () => {
    const urban = candidate([{ highway: "secondary", surface: "asphalt", maxspeed: "30", lit: "yes" }], {
      mostlyNonUrban: false
    });
    const rural = candidate([{ highway: "secondary", surface: "asphalt", maxspeed: "80" }], {
      mostlyNonUrban: true
    });
    expect(scoreExplore(extractRoadCyclingSegmentFeatures(rural)))
      .toBeGreaterThan(scoreExplore(extractRoadCyclingSegmentFeatures(urban)));
  });
});
