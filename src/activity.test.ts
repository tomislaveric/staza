import { describe, expect, it } from "vitest";
import {
  deriveActivity,
  deriveActivityResult,
  deriveDistanceXpRewards,
  distanceXpForActivity,
  MAX_NEAR_MISSES,
  NEAR_MISS_THRESHOLD_METERS
} from "./activity.js";
import { distanceMeters } from "./geometry.js";

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
    expect(result).toMatchObject({ activityId: "ride", collectedCount: 2, totalPoints: 80, baseXp: 50 });
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
    expect(result).toMatchObject({ collectedCount: 0, totalPoints: 50, baseXp: 50, distanceXp: 0, events: [] });
  });

  const longitudeAtMeters = (meters: number) => meters / 6_371_000 * 180 / Math.PI;
  const straightRoute = (meters: number) => [
    { latitude: 0, longitude: 0, timestampMs: 1_000 },
    { latitude: 0, longitude: longitudeAtMeters(meters), timestampMs: 1_000 + meters * 100 }
  ];
  const resultFor = (type: "cycling" | "running" | "hiking" | "walking" | "unknown", km: number) =>
    deriveActivityResult(deriveActivity("a", straightRoute(km * 1_000), type), []);

  it("awards base plus sport-weighted distance XP", () => {
    expect(resultFor("cycling", 40)).toMatchObject({ baseXp: 50, distanceXp: 80, totalPoints: 130 });
    expect(resultFor("running", 7.5)).toMatchObject({ distanceXp: 75, totalPoints: 125 });
    expect(resultFor("hiking", 10)).toMatchObject({ distanceXp: 70, totalPoints: 120 });
    for (const type of ["walking", "unknown"] as const) {
      expect(resultFor(type, 40)).toMatchObject({ distanceXp: 0, totalPoints: 50, distanceXpRewards: [] });
    }
  });

  it("awards base XP only for short and zero-distance routes", () => {
    expect(resultFor("running", 0)).toMatchObject({ distanceXp: 0, totalPoints: 50 });
    const zero = deriveActivityResult(deriveActivity("z", [
      { latitude: 0, longitude: 0, timestampMs: 1_000 },
      { latitude: 0, longitude: 0, timestampMs: 2_000 }
    ], "cycling"), []);
    expect(zero).toMatchObject({ distanceXp: 0, totalPoints: 50 });
    expect(zero.distanceXpRewards).toEqual([]);
    expect(resultFor("cycling", 0.1).totalPoints).toBe(50);
  });

  it("rounds distance XP once and rejects malformed distances", () => {
    expect(distanceXpForActivity("hiking", 7_500)).toBe(53);
    expect(distanceXpForActivity("running", undefined)).toBe(0);
    expect(() => distanceXpForActivity("running", -1)).toThrow(RangeError);
    expect(() => distanceXpForActivity("running", Number.NaN)).toThrow(RangeError);
    expect(() => distanceXpForActivity("running", Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("emits per-km and partial reward items that sum to distance XP", () => {
    const meters = 7_500;
    const result = resultFor("hiking", 7.5);
    const segment = distanceMeters(0, 0, 0, longitudeAtMeters(meters));
    expect(result.distanceXp).toBe(53);
    expect(result.distanceXpRewards).toHaveLength(8);
    expect(result.distanceXpRewards.slice(0, 7).every((reward) => reward.xpEarned === 7)).toBe(true);
    expect(result.distanceXpRewards[7]).toMatchObject({ xpEarned: 4, activityTimestampMs: 1_000 + meters * 100 });
    expect(result.distanceXpRewards.reduce((total, reward) => total + reward.xpEarned, 0)).toBe(53);
    result.distanceXpRewards.slice(0, 7).forEach((reward) => {
      expect(reward.activityTimestampMs).toBeCloseTo(1_000 + meters * 100 * reward.distanceMeters / segment, 3);
    });
  });

  it("keeps timestamps finite across zero-length segments", () => {
    const base = longitudeAtMeters(2_500);
    const rewards = deriveDistanceXpRewards([
      { latitude: 0, longitude: 0, timestampMs: 0 },
      { latitude: 0, longitude: 0, timestampMs: 10 },
      { latitude: 0, longitude: base, timestampMs: 20 }
    ], "running");
    expect(rewards).toHaveLength(3);
    rewards.forEach((reward) => expect(Number.isFinite(reward.activityTimestampMs)).toBe(true));
  });

  it("places every distance reward at its route-crossing timestamp", () => {
    const result = resultFor("running", 3);
    expect(result.distanceXpRewards.map(({ distanceMeters: distance, xpEarned }) => [Math.round(distance), xpEarned])).toEqual([
      [1_000, 10],
      [2_000, 10],
      [3_000, 10]
    ]);
    expect(deriveDistanceXpRewards(route)).toEqual([]);
  });

  it("adds distance XP to existing collectible points without changing the collectible award", () => {
    const longitudeAtMeters = (meters: number) => meters / 6_371_000 * 180 / Math.PI;
    const longRide = [
      { latitude: 0, longitude: 0, timestampMs: 1_000 },
      { latitude: 0, longitude: longitudeAtMeters(9_500), timestampMs: 10_500 },
      { latitude: 0, longitude: longitudeAtMeters(11_000), timestampMs: 12_000 }
    ];
    const collectible = {
      id: "coin",
      name: "Coin",
      type: "coin" as const,
      latitude: 0,
      longitude: longitudeAtMeters(9_500),
      radiusMeters: 20,
      value: 10
    };
    const result = deriveActivityResult(deriveActivity("long-ride", longRide, "cycling"), [collectible]);

    expect(result).toMatchObject({
      collectedCount: 1,
      distanceXp: 22,
      totalPoints: 82,
      events: [expect.objectContaining({ sourceId: "coin", value: 10 })]
    });
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

    expect(result).toMatchObject({ collectedCount: 1, totalPoints: 60 });
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
