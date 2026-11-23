import { describe, expect, it } from "vitest";
import type { Fartlek, WorldCollectible } from "./domain.js";
import { toWorldFartlek } from "./fartlek.js";
import { MAX_EXPLORE_HEIGHT_METERS, MAX_EXPLORE_RADIUS_METERS, MAX_EXPLORE_WIDTH_METERS, type OpportunityCandidate } from "./flowlineReveal.js";
import { viewportWidthMeters } from "./flowlinePolicy.js";
import type { GeoBounds } from "./worldQuery.js";
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
  const queried: GeoBounds[] = [];
  return {
    queried,
    dependencies: {
      flowlines: {
        listOpportunityCandidates: async (_player: string, bounds: GeoBounds) => { queried.push(bounds); return all.map(candidate); },
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

  it("reports nothing new in an empty area and explores the viewport itself when it fits", async () => {
    const world = fakeWorld([flowline("weak", { flowScore: 10 })]);
    expect(await exploreArea("p1", body, world.dependencies)).toMatchObject({
      outcome: "nothing_new", flowlines: [], collectibles: [], area: { bbox: body.bbox, clamped: false }
    });
  });

  it("clamps wide viewports to a centered max-size frame instead of rejecting them", async () => {
    const world = fakeWorld([]);
    const result = await exploreArea("p1", { bbox: "5,45,13,49" }, world.dependencies);
    const [frame] = world.queried;
    expect(result.area.clamped).toBe(true);
    expect(result.area.center.lat).toBeCloseTo(47);
    expect(result.area.center.lon).toBeCloseTo(9);
    expect(viewportWidthMeters(frame)).toBeCloseTo(MAX_EXPLORE_WIDTH_METERS, -2);
    expect((frame.maxLatitude - frame.minLatitude) * 111_320).toBeCloseTo(MAX_EXPLORE_HEIGHT_METERS, -2);
    expect((frame.minLongitude + frame.maxLongitude) / 2).toBeCloseTo(9);
    expect(result.area.bbox.split(",").map(Number)).toEqual([frame.minLongitude, frame.minLatitude, frame.maxLongitude, frame.maxLatitude].map((value) => Number(value.toFixed(6))));
  });

  it("explores only what lies inside a circle and reports the circle", async () => {
    const at = (id: string, coordinates: [number, number][]) => flowline(id, {
      flowScore: 90, geometry: { type: "LineString", coordinates }
    });
    const world = fakeWorld(
      [
        at("inside", [[9.5, 47.5], [9.501, 47.501]]),
        at("crossing", [[9.45, 47.505], [9.55, 47.505]]),
        at("outside", [[9.6, 47.6], [9.61, 47.61]])
      ],
      [collectible("near"), { ...collectible("far"), latitude: 47.6, longitude: 9.6 }]
    );
    const circle = { center: { lat: 47.5, lon: 9.5 }, radiusMeters: 1000 };
    const result = await exploreArea("p1", { circle }, world.dependencies);
    expect(result.flowlines.map((item) => item.id).sort()).toEqual(["crossing", "inside"]);
    expect(result.collectibles.map((item) => item.id)).toEqual(["near"]);
    expect(result.availableCount).toBe(0);
    expect(result.area).toMatchObject({ circle, clamped: false, center: circle.center });
    const [bounds] = world.queried;
    expect((bounds.maxLatitude - bounds.minLatitude) * 111_320).toBeCloseTo(2000, -1);
  });

  it("caps a circle's radius and rejects invalid circles", async () => {
    const world = fakeWorld([]);
    const result = await exploreArea("p1", { circle: { center: { lat: 47, lon: 9 }, radiusMeters: 200_000 } }, world.dependencies);
    expect(result.area.clamped).toBe(true);
    expect(result.area.circle?.radiusMeters).toBe(MAX_EXPLORE_RADIUS_METERS);
    await expect(exploreArea("p1", { circle: { center: { lat: 47 }, radiusMeters: 10 } }, world.dependencies)).rejects.toThrow();
    await expect(exploreArea("p1", { circle: { center: { lat: 47, lon: 9 }, radiusMeters: 0 } }, world.dependencies)).rejects.toThrow();
  });
});
