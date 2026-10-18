import { describe, expect, it } from "vitest";
import { createWorldSnapshot } from "./world.js";

const collectible = (id: string) => ({
  id,
  name: id,
  type: "coin" as const,
  latitude: 49,
  longitude: 8,
  radiusMeters: 15,
  value: 10
});

describe("World snapshot", () => {
  it("uses catalog membership and distinct persisted source IDs to derive discovery statistics", () => {
    const snapshot = createWorldSnapshot(
      [collectible("one"), collectible("two"), collectible("three")],
      ["two", "two", "removed-from-catalog", "three"]
    );

    expect(snapshot.collectibles.map((item) => [item.id, item.found, item.visibility])).toEqual([
      ["one", false, "visible"],
      ["two", true, "visible"],
      ["three", true, "visible"]
    ]);
    expect(snapshot.stats).toEqual({
      totalCollectibles: 3,
      discoveredCount: 2,
      remainingCount: 1
    });
  });

  it("supports an empty catalog without inventing a denominator", () => {
    expect(createWorldSnapshot([], ["historical-item"])).toEqual({
      collectibles: [],
      stats: {
        totalCollectibles: 0,
        discoveredCount: 0,
        remainingCount: 0
      }
    });
  });

  it("accepts a future player-specific visibility result without changing discovery truth", () => {
    const snapshot = createWorldSnapshot(
      [collectible("unexplored"), collectible("found")],
      ["found"],
      new Map([["unexplored", "hidden"]])
    );

    expect(snapshot.collectibles).toMatchObject([
      { id: "unexplored", found: false, visibility: "hidden" },
      { id: "found", found: true, visibility: "visible" }
    ]);
    expect(snapshot.stats).toMatchObject({ discoveredCount: 1, remainingCount: 1 });
  });
});
