import { describe, expect, it } from "vitest";
import { buildFartlekCandidates } from "./fartlekCandidates.js";
import type { OSMWayRecord } from "./fartlekModel.js";

const METERS_PER_DEGREE_LAT = 111_320;
const LAT = 50;
const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos((LAT * Math.PI) / 180);
const lonOffset = (meters: number): number => meters / metersPerDegreeLon;

/** A point `meters` east of the origin, at the fixed test latitude. */
const point = (meters: number): [number, number] => [lonOffset(meters), LAT];

const way = (
  osmId: string,
  fromMeters: number,
  toMeters: number,
  tags: Record<string, string> = {},
  waypointMeters: number[] = []
): OSMWayRecord => ({
  osmType: "way",
  osmId,
  coordinates: [fromMeters, ...waypointMeters, toMeters].map(point),
  tags: { highway: "secondary", ...tags }
});

const closeToMeters = (actual: number, expected: number): void => {
  expect(Math.abs(actual - expected)).toBeLessThan(10);
};

const boundaryNode = (osmId: string, meters: number, name?: string): OSMWayRecord => ({
  osmType: "node",
  osmId,
  coordinates: [point(meters)],
  tags: { traffic_sign: "city_limit", ...(name ? { name } : {}) }
});

const controlNode = (osmId: string, meters: number, tags: Record<string, string> = {}): OSMWayRecord => ({
  osmType: "node",
  osmId,
  coordinates: [point(meters)],
  tags: { highway: "traffic_signals", ...tags }
});

describe("buildFartlekCandidates", () => {
  it("builds one candidate from a single way bounded by city-limit nodes at both ends", () => {
    const ways = [way("w1", 0, 3_000, { ref: "K1", surface: "asphalt" })];
    const candidates = buildFartlekCandidates(ways, {
      boundaryNodes: [boundaryNode("b1", 0), boundaryNode("b2", 3_000)],
      controlNodes: []
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      name: "K1",
      hasClearBoundaries: true,
      sourceWayIds: ["w1"],
      junctionCount: 0,
      trafficControlCount: 0
    });
    closeToMeters(candidates[0].lengthMeters, 3_000);
  });

  it("names candidates from both named city-limit boundaries", () => {
    const ways = [way("w1", 0, 3_000, { name: "B 1" })];
    const candidates = buildFartlekCandidates(ways, {
      boundaryNodes: [boundaryNode("b1", 0, "Northville"), boundaryNode("b2", 3_000, "Southtown")],
      controlNodes: []
    });

    expect(candidates[0].name).toBe("Northville -> Southtown");
  });

  it("uses one named city-limit boundary and keeps the road name as context", () => {
    const ways = [way("w1", 0, 3_000, { name: "B 1" })];
    const candidates = buildFartlekCandidates(ways, {
      boundaryNodes: [boundaryNode("b1", 0, "Northville"), boundaryNode("b2", 3_000)],
      controlNodes: []
    });

    expect(candidates[0].name).toBe("Northville -> B 1");
  });

  it("places a single named city-limit boundary at the correct end of the title", () => {
    const ways = [way("w1", 0, 3_000, { ref: "B 1" })];
    const candidates = buildFartlekCandidates(ways, {
      boundaryNodes: [boundaryNode("b1", 0), boundaryNode("b2", 3_000, "Southtown")],
      controlNodes: []
    });

    expect(candidates[0].name).toBe("B 1 -> Southtown");
  });

  it("merges two connected same-ref ways sharing an endpoint into one chain", () => {
    const ways = [
      way("w1", 0, 2_000, { ref: "B1" }),
      way("w2", 2_000, 5_000, { ref: "B1" })
    ];
    const candidates = buildFartlekCandidates(ways, {
      boundaryNodes: [boundaryNode("b1", 0), boundaryNode("b2", 5_000)],
      controlNodes: []
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].sourceWayIds.sort()).toEqual(["w1", "w2"]);
    closeToMeters(candidates[0].lengthMeters, 5_000);
    expect(candidates[0].tagsBySegment).toHaveLength(2);
  });

  it("does not merge across a branch point where a third way joins the chain", () => {
    const ways = [
      way("w1", 0, 2_000, { ref: "B1" }),
      way("w2", 2_000, 5_000, { ref: "B1" }),
      // A spur road meeting the chain exactly at the w1/w2 junction (different identity).
      way("spur", 2_000, 2_500, { ref: "SPUR" })
    ];
    const candidates = buildFartlekCandidates(ways, {
      boundaryNodes: [boundaryNode("b1", 0), boundaryNode("b2", 5_000)],
      controlNodes: []
    });
    // w1/w2 still merge (same identity); the spur is a separate, boundary-less standalone chain.
    const merged = candidates.find((candidate) => candidate.sourceWayIds.includes("w1"));
    expect(merged?.sourceWayIds.sort()).toEqual(["w1", "w2"]);
    // The junction where the spur meets the merged chain should be detected (interior, not an endpoint).
    expect(merged?.junctionCount).toBe(1);
  });

  it("produces a whole-chain candidate with hasClearBoundaries=false when no boundary node matches", () => {
    const ways = [way("w1", 0, 4_000, { ref: "C1" })];
    const candidates = buildFartlekCandidates(ways, { boundaryNodes: [], controlNodes: [] });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].hasClearBoundaries).toBe(false);
  });

  it("counts traffic-control nodes near the candidate geometry", () => {
    const ways = [way("w1", 0, 3_000, { ref: "D1" }, [1_500])];
    const candidates = buildFartlekCandidates(ways, {
      boundaryNodes: [boundaryNode("b1", 0), boundaryNode("b2", 3_000)],
      controlNodes: [controlNode("c1", 1_500)]
    });
    expect(candidates[0].trafficControlCount).toBe(1);
  });

  it("keeps ways without a shared ref/name as independent standalone candidates", () => {
    const ways = [way("w1", 0, 2_000), way("w2", 2_000, 4_000)];
    const candidates = buildFartlekCandidates(ways, { boundaryNodes: [], controlNodes: [] });
    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.sourceWayIds)).toEqual([["w1"], ["w2"]]);
  });

  it("splits a chain into two candidates when a boundary node sits in the middle", () => {
    const ways = [way("w1", 0, 6_000, { ref: "E1" }, [3_000])];
    const candidates = buildFartlekCandidates(ways, {
      boundaryNodes: [boundaryNode("b1", 0), boundaryNode("b2", 3_000), boundaryNode("b3", 6_000)],
      controlNodes: []
    });
    expect(candidates).toHaveLength(2);
    expect(candidates.every((candidate) => candidate.hasClearBoundaries)).toBe(true);
    closeToMeters(candidates[0].lengthMeters, 3_000);
    closeToMeters(candidates[1].lengthMeters, 3_000);
  });

  it("flags mostly non-urban segments using rural maxspeed evidence, never from missing tags", () => {
    const ways = [way("w1", 0, 3_000, { ref: "F1", maxspeed: "80" })];
    const candidates = buildFartlekCandidates(ways, {
      boundaryNodes: [boundaryNode("b1", 0), boundaryNode("b2", 3_000)],
      controlNodes: []
    });
    expect(candidates[0].mostlyNonUrban).toBe(true);
  });

  it("flags urban segments from explicit residential/lit evidence", () => {
    const ways = [way("w1", 0, 3_000, { ref: "G1", highway: "residential", lit: "yes" })];
    const candidates = buildFartlekCandidates(ways, {
      boundaryNodes: [boundaryNode("b1", 0), boundaryNode("b2", 3_000)],
      controlNodes: []
    });
    expect(candidates[0].mostlyNonUrban).toBe(false);
  });
});
