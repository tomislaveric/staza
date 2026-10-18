import { describe, expect, it } from "vitest";
import {
  activeCollectionFeedback,
  collectiblePresentation,
  feedDisplayData,
  interpolatePosition,
  markerState,
  nearMissDisplayData,
  nextCollectibleData,
  replayCollectibles,
  replayCompletion,
  replayDurationSeconds,
  replayMarkers,
  replayScore
} from "./replay.js";

const coin = { id: "coin-1", name: "Park Coin", type: "coin", latitude: 0, longitude: 0 };
const landmark = { id: "landmark-1", name: "Town Hall", type: "landmark", latitude: 0.01, longitude: 0.01 };
const coinEvent = {
  sourceId: coin.id,
  collectible: { name: coin.name, type: coin.type },
  value: 25,
  latitude: coin.latitude,
  longitude: coin.longitude,
  activityTimestamp: 1_000
};
const landmarkEvent = {
  sourceId: landmark.id,
  collectible: { name: landmark.name, type: landmark.type },
  value: 50,
  latitude: landmark.latitude,
  longitude: landmark.longitude,
  activityTimestamp: 2_000
};

describe("activity replay", () => {
  it.each([
    [20 * 60, 12],
    [45 * 60, 22.5],
    [60 * 60, 30],
    [5 * 60, 12]
  ])("clamps a %i-second activity to %s replay seconds", (activityDuration, expected) => {
    expect(replayDurationSeconds(activityDuration)).toBe(expected);
  });

  it("interpolates the rider by FIT timestamp", () => {
    expect(interpolatePosition([
      { latitude: 0, longitude: 0, timestampMs: 1_000 },
      { latitude: 10, longitude: 20, timestampMs: 3_000 }
    ], 2_000)).toEqual({ latitude: 5, longitude: 10, timestampMs: 2_000 });
  });

  it("renders only the server-provided collectible subset", () => {
    const near = { id: "near" };
    const omittedFarAway = { id: "far-away" };

    expect(replayCollectibles({ collectibles: [near] })).toEqual([near]);
    expect(replayCollectibles({ collectibles: [near] })).not.toContain(omittedFarAway);
  });

  it("maps available, collecting, and collected marker states", () => {
    expect(markerState(coin.id, [coinEvent], 999)).toBe("available");
    expect(markerState(coin.id, [coinEvent], 1_000)).toBe("collecting");
    expect(markerState(coin.id, [coinEvent], 2_500)).toBe("collected");
  });

  it("distinguishes coin and landmark presentation without changing event behavior", () => {
    expect(collectiblePresentation(coin)).toMatchObject({ typeClass: "collectible-coin", typeLabel: "Coin" });
    expect(collectiblePresentation(landmark)).toMatchObject({ typeClass: "collectible-landmark", typeLabel: "Landmark" });
  });

  it("uses collectible names in the feed and falls back to source IDs", () => {
    expect(feedDisplayData([coinEvent], 1_000)[0]).toMatchObject({ name: "Park Coin", value: 25 });
    expect(feedDisplayData([{ ...coinEvent, collectible: {} }], 1_000)[0].name).toBe("coin-1");
  });

  it("finds the next relevant item and measures it from the rider", () => {
    const next = nextCollectibleData([coin, landmark], [coinEvent, landmarkEvent], 1_500, {
      latitude: 0,
      longitude: 0
    });
    expect(next).toMatchObject({ event: landmarkEvent, name: "Town Hall" });
    expect(next.distanceMeters).toBeGreaterThan(1_000);
  });

  it("updates score at event time and completes with canonical totals", () => {
    expect(replayScore([coinEvent, landmarkEvent], 999)).toBe(0);
    expect(replayScore([coinEvent, landmarkEvent], 1_000)).toBe(25);
    expect(replayScore([coinEvent, landmarkEvent], 2_000)).toBe(75);
    expect(replayScore([coinEvent, landmarkEvent], Number.POSITIVE_INFINITY)).toBe(75);
    expect(activeCollectionFeedback([coinEvent], 1_001)).toBe(coinEvent);
    expect(replayCompletion(12, 12, 0, 0)).toEqual({ collectedCount: 0, totalPoints: 0 });
    expect(replayCompletion(11.9, 12, 1, 25)).toBeUndefined();
  });

  it("keeps replay scoring limited to the current activity events", () => {
    expect(replayScore([coinEvent], Number.POSITIVE_INFINITY)).toBe(25);
    expect(replayScore([landmarkEvent], Number.POSITIVE_INFINITY)).toBe(50);
  });

  it("retains a marker for a collected event absent from relevant world sources", () => {
    const fallback = replayMarkers({ collectibles: [], events: [coinEvent] });
    expect(fallback).toMatchObject([{
      id: "coin-1",
      name: "Park Coin",
      latitude: 0,
      longitude: 0
    }]);
  });

  it("suppresses the near-miss presentation when there are no targets", () => {
    expect(nearMissDisplayData([])).toBeUndefined();
  });
});
