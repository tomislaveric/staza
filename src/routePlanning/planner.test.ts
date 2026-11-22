import { describe, expect, it } from "vitest";
import { areaAnchors, customizedStops, flowlineRidePoints, rerouteTargets, type RouteProvider } from "./planner.js";
import { constraintFitFlag, proposalHint } from "./proposals.js";
import { backtrackRatio, detourLengthM } from "./roundTrip.js";
import { RoutingError } from "./routingClient.js";
import { at, flowlineGeometry, objectivesFor, pointTarget, straightLineRoute } from "./testFixtures.js";
import type { QuestRouteTarget, RoutePlanningInput, RoutingRequest, ScoredRoute } from "./types.js";
import { traversedFlowlines, validateRoute } from "./validation.js";

const roundTrip = (km: number): RoutePlanningInput => ({
  start: at(0, 0),
  end: at(0, 0),
  routeType: "round_trip",
  constraint: { type: "distance", meters: km * 1000 }
});

const straightRouter = (): RouteProvider & { calls: RoutingRequest[] } => {
  const calls: RoutingRequest[] = [];
  return { calls, route: async (request) => { calls.push(request); return straightLineRoute(request); } };
};

describe("traversed Flowlines", () => {
  const ridden = flowlineGeometry("ridden", [2, 0], [4, 0]);
  const elsewhere = flowlineGeometry("elsewhere", [-8, -8], [-9, -8]);
  it("requires most of a Flowline to be covered and works without Flowlines", () => {
    const route = straightLineRoute({ profile: "bicycle", start: at(0, 0), end: at(0, 0), waypoints: [{ type: "via", ...at(5, 0) }] });
    expect(traversedFlowlines(route, [ridden, elsewhere]).map((flowline) => flowline.id)).toEqual(["ridden"]);
    expect(traversedFlowlines(route, [flowlineGeometry("crossing", [3, -1], [3, 1])])).toEqual([]);
    expect(traversedFlowlines(route, [])).toEqual([]);
  });
});

describe("proposal hints", () => {
  it("derives composition hints and ride-length fit", () => {
    expect(proposalHint({ peaks: 1, places: 2, other: 0 }, 40_000, 100)).toBe("discovery");
    expect(proposalHint({ peaks: 1, places: 0, other: 0 }, 40_000, 900)).toBe("climb");
    expect(proposalHint({ peaks: 0, places: 0, other: 2 }, 40_000, 100)).toBeUndefined();
    const routing = { distanceM: 70_000, durationS: 10_000 };
    expect(constraintFitFlag(roundTrip(50), routing as ScoredRoute["routing"])).toBe("long");
    expect(constraintFitFlag(roundTrip(70), routing as ScoredRoute["routing"])).toBe("within");
    expect(constraintFitFlag(roundTrip(100), routing as ScoredRoute["routing"])).toBe("short");
  });
});

describe("rerouteTargets", () => {
  const a = pointTarget("a", "", 4, 0);
  const b = pointTarget("b", "", 0, 4);
  const c = pointTarget("c", "", -4, 0);
  const reroute = (targets: QuestRouteTarget[], routing: RouteProvider = straightRouter()) => {
    const objectives = objectivesFor(targets.map((target) => ({ ...target, objectiveIds: ["places"] })), { places: targets.length });
    return rerouteTargets({
      requestId: "req",
      playerId: "player",
      scopeId: "exploration",
      base: { id: "base", label: "balanced", recommended: true },
      baseStops: [{ targetId: "a" }, { targetId: "b" }],
      targets: targets.map((target) => ({ ...target, objectiveIds: ["places"] })),
      objectives,
      flowlines: [],
      input: roundTrip(30)
    }, { routing, log: () => undefined });
  };

  it("keeps the base order when removing and inserts added targets cheaply", () => {
    expect(customizedStops(roundTrip(30), [{ targetId: "a" }, { targetId: "b" }], [b]).map((stop) => stop.target.id)).toEqual(["b"]);
    const order = customizedStops(roundTrip(30), [{ targetId: "a" }, { targetId: "b" }], [a, b, c]).map((stop) => stop.target.id);
    expect(order).toHaveLength(3);
    expect(new Set(order)).toEqual(new Set(["a", "b", "c"]));
  });

  it("re-plans exactly the edited set as a customized version of the base proposal", async () => {
    const router = straightRouter();
    const { proposal } = await reroute([a, b, c], router);
    expect(router.calls).toHaveLength(1);
    expect(proposal).toMatchObject({ label: "balanced", recommended: true, customized: true, basedOn: "base" });
    expect(proposal.includedTargetIds).toEqual(["a", "b", "c"]);
    expect(proposal.droppedTargetIds).toBeUndefined();
  });

  it("does not re-add a removed target the road still passes", async () => {
    // "b" was removed; the straight route to "a" and back would never be credited with it anyway,
    // and only the edited set is validated, so removed targets cannot reappear.
    const { proposal } = await reroute([a]);
    expect(proposal.includedTargetIds).toEqual(["a"]);
    expect(proposal.nearbyTargetIds).toEqual([]);
  });

  it("drops an unroutable added target and reports it", async () => {
    const blocked = at(-4, 0);
    const routing: RouteProvider = {
      route: async (request) => {
        const index = request.waypoints.findIndex((waypoint) =>
          Math.abs(waypoint.lat - blocked.lat) < 1e-5 && Math.abs(waypoint.lon - blocked.lon) < 1e-5);
        if (index >= 0) throw new RoutingError("point_not_routable", "Routing failed.", index + 1);
        return straightLineRoute(request);
      }
    };
    const { proposal } = await reroute([a, b, c], routing);
    expect(proposal.includedTargetIds).toEqual(["a", "b"]);
    expect(proposal.droppedTargetIds).toEqual(["c"]);
  });

  it("reports outages with a stable code", async () => {
    const down: RouteProvider = { route: async () => { throw new RoutingError("unavailable", "down"); } };
    await expect(reroute([a, b], down)).rejects.toMatchObject({ code: "routing_unavailable" });
  });
});

describe("validateRoute", () => {
  it("counts point targets only within the gameplay radius and reports nearby ones", () => {
    const close = pointTarget("close", "places", 2, 0);
    const near = pointTarget("near", "places", 2, 0.3);
    const far = pointTarget("far", "places", 2, 2);
    const route = straightLineRoute({ profile: "bicycle", start: at(0, 0), end: at(0, 0), waypoints: [{ type: "via", ...at(2, 0) }] });
    expect(validateRoute(route, [close, near, far])).toEqual({ includedTargetIds: ["close"], nearbyTargetIds: ["near"] });
  });
});

describe("areaAnchors", () => {
  const sw = at(-10, -10);
  const ne = at(10, 10);
  const bounds = { minLatitude: sw.lat, maxLatitude: ne.lat, minLongitude: sw.lon, maxLongitude: ne.lon };
  const flowline = flowlineGeometry("f", [4, 4], [4, 8]);
  const onFlowline = (point: { lat: number; lon: number }) => flowline.coordinates.some(([lon, lat]) => lon === point.lon && lat === point.lat);
  const loop = { stops: 3, reach: 0.55 };

  it("bends cycling anchors to nearby Flowlines but never running or hiking ones", () => {
    const cycling = areaAnchors({ ...roundTrip(30), sport: "cycling" }, bounds, [flowline], loop);
    expect(cycling.some(onFlowline)).toBe(true);
    for (const sport of ["running", "hiking"] as const) {
      const anchors = areaAnchors({ ...roundTrip(30), sport }, bounds, [flowline], loop);
      expect(anchors).toHaveLength(3);
      expect(anchors.some(onFlowline)).toBe(false);
    }
  });
});

describe("flowlineRidePoints", () => {
  it("rides a Flowline from the end nearer the start through its middle to the far end", () => {
    const flowline = flowlineGeometry("f", [5, 0], [1, 0]);
    const points = flowlineRidePoints(at(0, 0), flowline);
    const [lon, lat] = flowline.coordinates[3];
    expect(points).toEqual([
      { lat: flowline.coordinates[5][1], lon: flowline.coordinates[5][0] },
      { lat, lon },
      { lat: flowline.coordinates[0][1], lon: flowline.coordinates[0][0] }
    ]);
  });
});

describe("backtrackRatio", () => {
  const line = (points: Array<[number, number]>) => points.map(([n, e]) => [at(n, e).lon, at(n, e).lat] as [number, number]);

  it("flags out-and-back routes but not loops", () => {
    expect(backtrackRatio(line([[0, 0], [0, 5], [0, 0]]))).toBeGreaterThan(0.4);
    expect(backtrackRatio(line([[0, 0], [0, 5], [5, 5], [5, 0], [0, 0]]))).toBeLessThan(0.1);
  });
});

describe("detourLengthM", () => {
  const line = (points: Array<[number, number]>) => points.map(([n, e]) => [at(n, e).lon, at(n, e).lat] as [number, number]);

  it("flags short local spurs but not a clean loop", () => {
    expect(detourLengthM(line([[0, 0], [0, 2], [0.8, 2], [0, 2], [0, 4], [4, 4], [4, 0], [0, 0]]))).toBeGreaterThan(150);
    expect(detourLengthM(line([[0, 0], [0, 4], [4, 4], [4, 0], [0, 0]]))).toBe(0);
  });
});
