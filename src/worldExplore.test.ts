import { describe, expect, it } from "vitest";
import type { Fartlek } from "./domain.js";
import { toWorldFartlek } from "./fartlek.js";
import type { RevealCandidate } from "./flowlineReveal.js";
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

const fakeWorld = (all: Fartlek[], revealedAtStart: string[] = []) => {
  const revealed = new Set(revealedAtStart);
  const candidate = (item: Fartlek): RevealCandidate => ({
    id: item.id, flowScore: item.flowScore, enduranceScore: item.enduranceScore, exploreScore: item.exploreScore
  });
  return {
    revealed,
    dependencies: {
      reveals: {
        countRevealedWithinBounds: async () => all.filter((item) => revealed.has(item.id)).length,
        listHiddenCandidatesWithinBounds: async () => all.filter((item) => !revealed.has(item.id)).map(candidate),
        reveal: async (_player: string, ids: string[]) => {
          const fresh = ids.filter((id) => !revealed.has(id));
          fresh.forEach((id) => revealed.add(id));
          return fresh;
        },
        listByIds: async (ids: string[]) => all.filter((item) => ids.includes(item.id))
      },
      toWorld: async (_player: string, items: Fartlek[]) => items.map((item) => toWorldFartlek(item))
    }
  };
};

const body = { bbox: "9.4,47.4,9.6,47.6" };

describe("exploreArea", () => {
  it("reveals eligible Flowlines best first and summarizes them by character", async () => {
    const world = fakeWorld([
      flowline("a", { flowScore: 84 }),
      flowline("b", { flowScore: 55, enduranceScore: 90 }),
      flowline("c", { flowScore: 20 })
    ]);
    const result = await exploreArea("p1", body, world.dependencies);
    expect(result.outcome).toBe("discovered");
    expect(result.revealed.map((item) => item.id)).toEqual(["b", "a"]);
    expect(result.summary).toEqual({ total: 2, byCharacter: { flow: 1, endurance: 1, explore: 0 } });
    expect(result.knownCount).toBe(2);
    expect(world.revealed).toEqual(new Set(["a", "b"]));
  });

  it("never re-discovers known Flowlines and reveals only new ones", async () => {
    const world = fakeWorld([flowline("a", { flowScore: 84 }), flowline("n", { flowScore: 70 })], ["a"]);
    const first = await exploreArea("p1", body, world.dependencies);
    expect(first).toMatchObject({ outcome: "already_explored_new", knownCount: 2, summary: { total: 1 } });
    const second = await exploreArea("p1", body, world.dependencies);
    expect(second).toMatchObject({ outcome: "already_explored", revealed: [], knownCount: 2 });
  });

  it("reports nothing new in an empty area and rejects areas that are too wide", async () => {
    const world = fakeWorld([flowline("weak", { flowScore: 10 })]);
    expect(await exploreArea("p1", body, world.dependencies)).toMatchObject({ outcome: "nothing_new", revealed: [] });
    await expect(exploreArea("p1", { bbox: "5,47,12,48" }, world.dependencies)).rejects.toThrow(/Zoom in/);
  });
});
