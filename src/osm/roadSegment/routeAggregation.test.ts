import { describe, expect, it } from "vitest";
import {
  aggregateRouteSegments,
  scoreRouteForStyle,
  type TraversedSegment
} from "./routeAggregation.js";

const segment = (
  id: string,
  coveredMeters: number,
  scores: Partial<TraversedSegment["scores"]> = {}
): TraversedSegment => ({
  id,
  coveredMeters,
  scores: { flow: 80, endurance: 60, explore: 40, roadQuality: 70, dataConfidence: 0.8, ...scores }
});

describe("route segment aggregation", () => {
  it("distance-weights style scores so longer segments dominate", () => {
    const profile = aggregateRouteSegments(
      [segment("a", 9_000, { flow: 90 }), segment("b", 1_000, { flow: 10 })],
      10_000
    );
    expect(profile.flow).toBe(82); // (90*9000 + 10*1000) / 10000
    expect(profile.coverageRatio).toBe(1);
    expect(profile.segmentCount).toBe(2);
  });

  it("caps covered meters at the route length and reports partial coverage", () => {
    const profile = aggregateRouteSegments([segment("a", 4_000)], 10_000);
    expect(profile.coveredMeters).toBe(4_000);
    expect(profile.coverageRatio).toBeCloseTo(0.4, 5);
  });

  it("returns a zeroed profile for a route with no scored segments", () => {
    const profile = aggregateRouteSegments([], 10_000);
    expect(profile.flow).toBe(0);
    expect(profile.coverageRatio).toBe(0);
  });

  it("ranks a flow-heavy route higher under the flow style than the explore style", () => {
    const segments = [segment("a", 10_000, { flow: 95, explore: 10 })];
    const flow = scoreRouteForStyle(segments, 10_000, "flow");
    const explore = scoreRouteForStyle(segments, 10_000, "explore");
    expect(flow.fit).toBeGreaterThan(explore.fit);
    expect(flow.style).toBe("flow");
  });

  it("excludes low-confidence segments from the style rating", () => {
    const segments = [segment("a", 10_000, { flow: 95, dataConfidence: 0.2 })];
    const result = scoreRouteForStyle(segments, 10_000, "flow");
    expect(result.profile.segmentCount).toBe(0);
    expect(result.fit).toBe(0);
  });
});
