import { describe, expect, it } from "vitest";
import { deriveActivity, deriveActivityResult, MAX_NEAR_MISSES, NEAR_MISS_THRESHOLD_METERS } from "./activity.js";

const route = [
  { latitude: 0, longitude: 0, timestampMs: 1_000 },
  { latitude: 0, longitude: 0.001, timestampMs: 61_000 },
  { latitude: 0, longitude: 0.002, timestampMs: 121_000 }
];

describe("activity derivation", () => {
  it("uses a 200 m near-miss threshold", () => {
    expect(NEAR_MISS_THRESHOLD_METERS).toBe(200);
  });

  it("derives route measurements and canonical timestamp-ordered events", () => {
    const activity = deriveActivity("ride", route);
    const result = deriveActivityResult(activity, [
      { id: "later", name: "Later", type: "landmark", latitude: 0, longitude: 0.00195, radiusMeters: 10, value: 20 },
      { id: "first", name: "First", type: "coin", latitude: 0, longitude: 0.00095, radiusMeters: 10, value: 10 }
    ]);

    expect(activity).toMatchObject({ id: "ride", source: "fit", type: "unknown", startedAt: 1_000, endedAt: 121_000, duration: 120 });
    expect(activity.distance).toBeGreaterThan(200);
    expect(result).toMatchObject({ activityId: "ride", collectedCount: 2, totalPoints: 30 });
    expect(result.events.map((event) => event.sourceId)).toEqual(["first", "later"]);
    expect(result.events.map((event) => event.collectible.name)).toEqual(["First", "Later"]);
    expect(result.events.every((event) => event.videoSecond === undefined)).toBe(true);
  });

  it("retains an explicitly supplied non-cycling activity type without changing derivation", () => {
    expect(deriveActivity("run", route, "running")).toMatchObject({
      id: "run",
      type: "running",
      distance: expect.any(Number),
      duration: 120
    });
  });

  it("completes a zero-collectible activity", () => {
    const result = deriveActivityResult(deriveActivity("ride", route), []);
    expect(result).toMatchObject({ collectedCount: 0, totalPoints: 0, events: [] });
  });

  it("uses the relevant presentation subset and retains each collected source", () => {
    const near = { id: "near", name: "Near", type: "coin" as const, latitude: 0, longitude: 0.00095, radiusMeters: 10, value: 10 };
    const relevantCollectibles = [near];
    const result = deriveActivityResult(deriveActivity("ride", route), relevantCollectibles);

    expect(result.collectibles).toBe(relevantCollectibles);
    expect(result.collectibles).toEqual([near]);
    expect(result.events.every((event) => result.collectibles.some((item) => item.id === event.sourceId))).toBe(true);
  });

  it("collects within 100 m and reports misses within 200 m", () => {
    const metersToLatitude = (meters: number) => meters / 6_371_000 * 180 / Math.PI;
    const routeAt97Meters = [
      { latitude: metersToLatitude(97), longitude: -0.001, timestampMs: 1_000 },
      { latitude: metersToLatitude(97), longitude: 0, timestampMs: 2_000 },
      { latitude: metersToLatitude(97), longitude: 0.001, timestampMs: 3_000 }
    ];
    const result = deriveActivityResult(deriveActivity("radius-check", routeAt97Meters), [
      { id: "within-100m", name: "Within collection radius", type: "landmark", latitude: 0, longitude: 0, radiusMeters: 100, value: 10 },
      { id: "within-200m", name: "Nearby miss", type: "landmark", latitude: metersToLatitude(247), longitude: 0, radiusMeters: 100, value: 20 }
    ]);

    expect(result.events.map((event) => event.sourceId)).toEqual(["within-100m"]);
    expect(result.nearMisses).toMatchObject([
      { collectibleId: "within-200m", minimumDistanceMeters: expect.closeTo(150, 0) }
    ]);
  });

  it("derives bounded, distance-sorted near misses without changing collected results", () => {
    const metersToLatitude = (meters: number) => meters / 6_371_000 * 180 / Math.PI;
    const collected = { id: "collected", name: "Collected", type: "coin" as const, latitude: 0, longitude: 0.00095, radiusMeters: 10, value: 10 };
    const atFiftyMeters = { id: "fifty", name: "Fifty", type: "coin" as const, latitude: metersToLatitude(50), longitude: 0.001, radiusMeters: 1, value: 20 };
    const atThreshold = { id: "threshold", name: "Threshold", type: "landmark" as const, latitude: metersToLatitude(NEAR_MISS_THRESHOLD_METERS), longitude: 0.001, radiusMeters: 1, value: 30 };
    const beyondThreshold = { id: "beyond", name: "Beyond", type: "coin" as const, latitude: metersToLatitude(201), longitude: 0.001, radiusMeters: 1, value: 40 };
    const extraNearMisses = Array.from({ length: 5 }, (_, index) => ({
      id: `extra-${index}`,
      name: `Extra ${index}`,
      type: "coin" as const,
      latitude: metersToLatitude(55 + index * 5),
      longitude: 0.001,
      radiusMeters: 1,
      value: 1
    }));

    const result = deriveActivityResult(deriveActivity("ride", route), [
      collected,
      atFiftyMeters,
      atThreshold,
      beyondThreshold,
      ...extraNearMisses
    ]);

    expect(result).toMatchObject({ collectedCount: 1, totalPoints: 10 });
    expect(result.nearMisses).toHaveLength(MAX_NEAR_MISSES);
    expect(result.nearMisses.map((nearMiss) => nearMiss.collectibleId)).toEqual([
      "fifty",
      "extra-0",
      "extra-1",
      "extra-2",
      "extra-3"
    ]);
    expect(result.nearMisses.some((nearMiss) => nearMiss.collectibleId === "collected")).toBe(false);
    expect(result.nearMisses.some((nearMiss) => nearMiss.collectibleId === "beyond")).toBe(false);
    expect(result.nearMisses.find((nearMiss) => nearMiss.collectibleId === "fifty")?.minimumDistanceMeters).toBeCloseTo(50, 3);
    expect(
      deriveActivityResult(deriveActivity("ride", route), [atThreshold]).nearMisses
    ).toMatchObject([{ collectibleId: "threshold" }]);
  });
});
