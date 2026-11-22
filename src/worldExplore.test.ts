import { describe, expect, it } from "vitest";
import type { Fartlek, WorldCollectible } from "./domain.js";
import { toWorldFartlek } from "./fartlek.js";
import type { OpportunityCandidate } from "./flowlineReveal.js";
import { exploreArea } from "./worldExplore.js";

const flowline = (id: string, scores: Partial<Fartlek>): Fartlek => ({
  id,
  name: id,
  geometry: { type: "LineString", coordinates: [[9.5, 47.5], [9.51, 47.51]] },
  startLatitude: 47.5,
  startLongitude: 9.5,
  endLatitude: 47.51,
  endLongitude: 9.51,
  lengthMeters: 3800,
  status: "published",
  source: { sourceType: "osm", sourceExternalId: id },
  suitabilityScore: scores.flowScore ?? 0,
  suitabilityReasons: [],
  mappingConfidence: 90,
  geometryVersion: 1,
  ...scores
});

const collectible = (id: string): WorldCollectible => ({
  id, name: id, type: "landmark", latitude: 47.5, longitude: 9.5, found: false
} as WorldCollectible);

const fakeWorld = (all: Fartlek[], collectibles: WorldCollectible[] = []) => {
  const candidate = (item: Fartlek): OpportunityCandidate => ({
    id: item.id, flowScore: item.flowScore, enduranceScore: item.enduranceScore, exploreScore: item.exploreScore
  });
  return {
    dependencies: {
      flowlines: {
        listOpportunityCandidates: async () => all.map(candidate),
        listByIds: async (ids: string[]) => all.filter((item) => ids.includes(item.id))
      },
      listUncollectedCollectibles: async () => ({ collectibles, truncated: false }),
      toWorld: async (_player: string, items: Fartlek[]) => items.map((item) => toWorldFartlek(item))
    }
  };
};

const body = { bbox: "9.4,47.4,9.6,47.6" };

describe("exploreArea", () => {
  it("shows eligible Flowlines best first with uncollected collectibles and summarizes them", async () => {
    const world = fakeWorld([
      flowline("a", { flowScore: 84 }),
      flowline("b", { flowScore: 55, enduranceScore: 90 }),
      flowline("c", { flowScore: 20 })
    ], [collectible("peak-1")]);
    const result = await exploreArea("p1", body, world.dependencies);
    expect(result.outcome).toBe("discovered");
    expect(result.flowlines.map((item) => item.id)).toEqual(["b", "a"]);
    expect(result.collectibles.map((item) => item.id)).toEqual(["peak-1"]);
    expect(result.summary).toEqual({ total: 2, byCharacter: { flow: 1, endurance: 1, explore: 0 }, collectibles: 1 });
  });

  it("is temporary: exploring the same area again shows the same opportunities", async () => {
    const world = fakeWorld([flowline("a", { flowScore: 84 }), flowline("n", { flowScore: 70 })]);
    const first = await exploreArea("p1", body, world.dependencies);
    const second = await exploreArea("p1", body, world.dependencies);
    expect(second).toEqual(first);
    expect(Object.keys(world.dependencies)).not.toContain("reveal");
  });

  it("reports nothing new in an empty area and rejects areas that are too wide", async () => {
    const world = fakeWorld([flowline("weak", { flowScore: 10 })]);
    expect(await exploreArea("p1", body, world.dependencies)).toMatchObject({ outcome: "nothing_new", flowlines: [], collectibles: [] });
    await expect(exploreArea("p1", { bbox: "5,47,12,48" }, world.dependencies)).rejects.toThrow(/Zoom in/);
  });
});
