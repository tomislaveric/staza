import { describe, expect, it } from "vitest";
import { areaAnchors, flowlineRidePoints, MAX_FLOWLINE_RIDE_POINTS, MAX_TRACE_ANCHORS, tracedStops, rerouteTargets, type RouteProvider } from "./planner.js";
import { constraintFitFlag, proposalHint } from "./proposals.js";
import { backtrackRatio, detourLengthM, routeKnots } from "./roundTrip.js";
import { RoutingError } from "./routingClient.js";
import { distanceBetween, toLatLon } from "./geo.js";
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
  const lonLat = (point: { lat: number; lon: number }): [number, number] => [point.lon, point.lat];
  // A 16 km square loop the base route rode: north, east, south, back west.
  const loop = [at(0, 0), at(4, 0), at(4, 4), at(0, 4), at(0, 0)].map(lonLat);
  const reroute = (targets: QuestRouteTarget[], routing: RouteProvider = straightRouter()) => {
    const objectives = objectivesFor(targets.map((target) => ({ ...target, objectiveIds: ["places"] })), { places: targets.length });
    return rerouteTargets({
      requestId: "req",
      playerId: "player",
      scopeId: "exploration",
      base: { id: "base", label: "balanced", recommended: true, geometry: { type: "LineString", coordinates: loop } },
      targets: targets.map((target) => ({ ...target, objectiveIds: ["places"] })),
      objectives,
      flowlines: [],
      input: roundTrip(30)
    }, { routing, log: () => undefined });
  };

  it("follows the base road and opens it only around an added stop", () => {
    const side = pointTarget("side", "", 2, 4.2);
    const stops = tracedStops(loop, [side]);
    const ids = stops.map((stop) => stop.target.id);
    expect(ids.filter((id) => !id.startsWith("waypoint:"))).toEqual(["side"]);
    const anchors = stops.filter((stop) => stop.target.id.startsWith("waypoint:"));
    expect(anchors.length).toBeGreaterThan(10);
    expect(anchors.length).toBeLessThanOrEqual(MAX_TRACE_ANCHORS);
    // Every anchor lies on the base road, and none sits right next to the detour.
    for (const { target } of anchors) {
      expect(Math.min(...loop.map((point) => distanceBetween(toLatLon(point), target.coordinate)))).toBeLessThan(4_100);
      expect(distanceBetween(target.coordinate, at(2, 4))).toBeGreaterThan(700);
    }
    // The stop is inserted where it lies along the loop: after anchors on the first two sides.
    const index = ids.indexOf("side");
    expect(stops.slice(0, index).some((stop) => distanceBetween(stop.target.coordinate, at(4, 2)) < 900)).toBe(true);
    expect(stops.slice(index + 1).some((stop) => distanceBetween(stop.target.coordinate, at(0, 2)) < 900)).toBe(true);
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

describe("areaAnchors Flowline direction", () => {
  const sw = at(-10, -10);
  const ne = at(10, 10);
  const bounds = { minLatitude: sw.lat, maxLatitude: ne.lat, minLongitude: sw.lon, maxLongitude: ne.lon };
  const input = { ...roundTrip(30), start: at(0, 5), sport: "cycling" as const };
  const loop = { stops: 1, reach: 0.55 };

  it("rides a Flowline along the loop end to end in travel direction", () => {
    const along = flowlineGeometry("along", [1, 5.5], [-1, 5.5]);
    const anchors = areaAnchors(input, bounds, [along], loop);
    expect(anchors).toHaveLength(3);
    expect(anchors[0].lat).toBeLessThan(anchors[2].lat);
  });

  it("ignores a Flowline that crosses the loop direction", () => {
    const crossing = flowlineGeometry("crossing", [0, 4.5], [0, 6.5]);
    const anchors = areaAnchors(input, bounds, [crossing], loop);
    expect(anchors).toHaveLength(1);
    expect(crossing.coordinates.some(([lon, lat]) => lon === anchors[0].lon && lat === anchors[0].lat)).toBe(false);
  });
});

describe("flowlineRidePoints", () => {
  it("rides a Flowline from the end nearer the start to the far end", () => {
    const flowline = flowlineGeometry("f", [5, 0], [1, 0]);
    const points = flowlineRidePoints(at(0, 0), flowline);
    const reversed = [...flowline.coordinates].reverse().map(([lon, lat]) => ({ lat, lon }));
    expect(points[0]).toEqual(reversed[0]);
    expect(points.at(-1)).toEqual(reversed.at(-1));
  });

  it("keeps a short bend the router would otherwise cut", () => {
    const coordinates = [at(0, 0), at(0.3, 0.1), at(0.6, 0), at(1.2, 0)].map(({ lat, lon }) => [lon, lat] as [number, number]);
    const points = flowlineRidePoints(at(0, 0), { id: "b", name: "b", coordinates, lengthMeters: 1_300 });
    expect(points).toContainEqual({ lat: coordinates[1][1], lon: coordinates[1][0] });
  });

  it("pins a long, bending Flowline densely enough that the router cannot cut the bend", () => {
    const coordinates = Array.from({ length: 81 }, (_value, index) => {
      const point = index <= 40 ? at(index * 0.1, 0) : at(4, (index - 40) * 0.1);
      return [point.lon, point.lat] as [number, number];
    });
    const flowline = { id: "bend", name: "bend", coordinates, lengthMeters: 8_000 };
    const points = flowlineRidePoints(at(0, 0), flowline);
    expect(points[0]).toEqual({ lat: coordinates[0][1], lon: coordinates[0][0] });
    expect(points[points.length - 1]).toEqual({ lat: coordinates[80][1], lon: coordinates[80][0] });
    expect(points, "the corner").toContainEqual({ lat: coordinates[40][1], lon: coordinates[40][0] });
    expect(points.length).toBeLessThanOrEqual(MAX_FLOWLINE_RIDE_POINTS);
    expect(points.length).toBeGreaterThan(3);
    const gaps = points.slice(1).map((point, index) => distanceBetween(points[index], point));
    expect(Math.max(...gaps)).toBeLessThan(1_000);
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

describe("routeKnots", () => {
  const line = (points: Array<[number, number]>) => points.map(([n, e]) => [at(n, e).lon, at(n, e).lat] as [number, number]);

  it("flags a small self-crossing loop but not bends, roundabouts or the tour's own shape", () => {
    // Rides east, loops 400 m north and crosses its own path before continuing.
    expect(routeKnots(line([[0, 0], [0, 2], [0.4, 2], [0.4, 1.8], [-0.2, 1.8], [-0.2, 4]]))).toHaveLength(1);
    expect(routeKnots(line([[0, 0], [0, 4], [4, 4], [4, 0], [0, 0]]))).toHaveLength(0);
    expect(routeKnots(line([[0, 0], [0, 2], [0.03, 2], [0.03, 1.97], [-0.01, 1.97], [-0.01, 4]]))).toHaveLength(0);
    expect(routeKnots(line([[0, 0], [0, 4], [3, 4], [3, 2], [-1, 2], [-1, 0]]))).toHaveLength(0);
  });
});
