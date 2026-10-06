import { describe, expect, it } from "vitest";
import {
  FARTLEK_COMPLETION_XP,
  fartlekIntersectsBounds,
  lineStringLengthMeters,
  toWorldFartlek
} from "./fartlek.js";
import type { Fartlek } from "./domain.js";

describe("lineStringLengthMeters", () => {
  it("sums haversine distances between consecutive vertices", () => {
    const length = lineStringLengthMeters([
      [10, 50],
      [10.02, 50],
      [10.02, 50.01]
    ]);
    expect(length).toBeGreaterThan(1_000);
  });
});

describe("fartlekIntersectsBounds", () => {
  const geometry = { type: "LineString" as const, coordinates: [[10, 50], [10.1, 50.1]] as [number, number][] };

  it("is true when a vertex falls inside the bounds", () => {
    expect(fartlekIntersectsBounds(geometry, { minLatitude: 49.9, maxLatitude: 50.05, minLongitude: 9.9, maxLongitude: 10.05 }))
      .toBe(true);
  });

  it("is false when no vertex falls inside the bounds", () => {
    expect(fartlekIntersectsBounds(geometry, { minLatitude: 60, maxLatitude: 61, minLongitude: 20, maxLongitude: 21 }))
      .toBe(false);
  });
});

describe("toWorldFartlek", () => {
  const fartlek: Fartlek = {
    id: "fartlek-1",
    name: "Alpine Approach",
    geometry: { type: "LineString", coordinates: [[10, 50], [10.1, 50.1]] },
    startLatitude: 50,
    startLongitude: 10,
    endLatitude: 50.1,
    endLongitude: 10.1,
    lengthMeters: 4_000,
    status: "published",
    source: { sourceType: "osm", sourceExternalId: "way:1" },
    suitabilityScore: 90,
    suitabilityReasons: ["Continuous asphalt surface evidence: +15"],
    mappingConfidence: 95,
    geometryVersion: 1
  };

  it("never carries point-collectible fields and defaults to uncompleted", () => {
    const worldFartlek = toWorldFartlek(fartlek);
    expect(worldFartlek).toMatchObject({ id: "fartlek-1", completed: false, completionCount: 0 });
    expect(worldFartlek).not.toHaveProperty("radiusMeters");
    expect(worldFartlek.geometry.type).toBe("LineString");
  });

  it("carries completion stats when provided", () => {
    const worldFartlek = toWorldFartlek(fartlek, {
      completed: true,
      completionCount: 3,
      bestElapsedTimeS: 600,
      latestCompletion: {
        id: "completion-1",
        fartlekId: "fartlek-1",
        playerId: "player-1",
        activityId: "activity-1",
        completedAt: "2026-01-01T00:00:00.000Z",
        elapsedTimeS: 650,
        averageSpeedMps: 6.15,
        traversalDirection: "a_to_b",
        fartlekLengthMSnapshot: 4_000,
        fartlekGeometryVersionSnapshot: 1
      }
    });
    expect(worldFartlek.completed).toBe(true);
    expect(worldFartlek.completionCount).toBe(3);
    expect(worldFartlek.bestElapsedTimeS).toBe(600);
    expect(worldFartlek.latestCompletion?.elapsedTimeS).toBe(650);
  });
});

describe("FARTLEK_COMPLETION_XP", () => {
  it("is a flat constant independent of length/speed", () => {
    expect(FARTLEK_COMPLETION_XP).toBe(50);
  });
});
