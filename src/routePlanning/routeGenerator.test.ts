import { describe, expect, it } from "vitest";
import { flowlineFit, GENERATION_POLICY, generationLengthMeters, lateralJogs, poiValue, sharpTurns } from "./generationPolicy.js";
import { generateRoute } from "./routeGenerator.js";
import type { RouteProvider } from "./planner.js";
import { PLANNING_LIMITS } from "./policy.js";
import { RoutingError } from "./routingClient.js";
import { backtrackRatio, routeKnots } from "./roundTrip.js";
import { at, flowlineGeometry, pointTarget, straightLineRoute } from "./testFixtures.js";
import type { FlowlineGeometry, QuestRouteTarget, RoutePlanningInput, RoutingRequest } from "./types.js";

const sw = at(-10, -10);
const ne = at(10, 10);
const bounds = { minLatitude: sw.lat, maxLatitude: ne.lat, minLongitude: sw.lon, maxLongitude: ne.lon };
const AREA_METERS = 56_000;

const ride = (sport: RoutePlanningInput["sport"] = "cycling"): RoutePlanningInput => ({
  start: at(0, 0),
  end: at(0, 0),
  routeType: "round_trip",
  sport,
  constraint: { type: "distance", meters: generationLengthMeters(AREA_METERS) }
});

const straightRouter = (): RouteProvider & { calls: RoutingRequest[] } => {
  const calls: RoutingRequest[] = [];
  return { calls, route: async (request) => { calls.push(request); return straightLineRoute(request); } };
};

const generate = (
  { targets = [], flowlines = [], routing = straightRouter(), sport }: {
    targets?: QuestRouteTarget[];
    flowlines?: FlowlineGeometry[];
    routing?: RouteProvider;
    sport?: RoutePlanningInput["sport"];
  } = {}
) => generateRoute(
  { requestId: "req", playerId: "player", scopeId: "exploration", targets, flowlines, input: ride(sport), bounds },
  { routing, log: () => undefined }
);

const scored = (id: string, from: [number, number], to: [number, number], scores: FlowlineGeometry["scores"]): FlowlineGeometry =>
  ({ ...flowlineGeometry(id, from, to), scores });
const highFlow = scored("high-flow", [2, 3], [7, 3], { flow: 95, endurance: 60, explore: 40, roadQuality: 90 });

/** Castles far off any sensible loop, in the area's corners. */
const cornerCastles = [
  pointTarget("castle-ne", "", 9.5, 9.5, { category: "castle" }),
  pointTarget("castle-nw", "", 9.5, -9.5, { category: "castle" }),
  pointTarget("castle-se", "", -9.5, 9.5, { category: "castle" }),
  pointTarget("castle-sw", "", -9.5, -9.5, { category: "castle" })
];

/** Collectibles just beside the way out of the start: cheap to add, of several kinds. */
const besideStart = [
  pointTarget("castle-1", "", 0.4, 1.5, { category: "castle" }),
  pointTarget("castle-2", "", -0.4, 2, { category: "castle" }),
  pointTarget("castle-3", "", 0.4, 2.5, { category: "castle" }),
  pointTarget("peak", "", -0.4, 3, { category: "peak" }),
  pointTarget("viewpoint", "", 0.4, 3.5, { category: "viewpoint" })
];

const categories = (ids: string[], targets: QuestRouteTarget[]) =>
  ids.map((id) => targets.find((target) => target.id === id)?.category);

describe("generation policy", () => {
  it("scales and caps the area-derived length", () => {
    expect(generationLengthMeters(AREA_METERS)).toBeLessThan(AREA_METERS);
    expect(generationLengthMeters(300_000)).toBe(GENERATION_POLICY.maxLengthMeters);
    expect(generationLengthMeters(0)).toBe(PLANNING_LIMITS.minDistanceMeters);
  });

  it("values variety over more of the same category", () => {
    const [castle1, castle2] = besideStart;
    const peak = besideStart[3];
    expect(poiValue([castle1, castle2])).toBeLessThan(poiValue([castle1, peak]));
    expect(poiValue([castle1, { ...castle2, alreadyAchieved: true }])).toBeLessThan(poiValue([castle1, castle2]));
  });

  it("ranks good Flowlines above poor and completed ones", () => {
    const poor = scored("poor", [0, 0], [1, 0], { flow: 20, endurance: 30, explore: 30, roadQuality: 30 });
    expect(flowlineFit(highFlow)).toBeGreaterThan(flowlineFit(poor));
    expect(flowlineFit({ ...highFlow, completed: true })).toBeLessThan(flowlineFit(highFlow));
  });

  it("counts sharp turns, not gentle bends", () => {
    const line = (points: Array<[number, number]>) => points.map(([n, e]) => [at(n, e).lon, at(n, e).lat] as [number, number]);
    const route = (points: Array<[number, number]>) =>
      straightLineRoute({ profile: "bicycle", start: at(...points[0]), end: at(...points.at(-1)!), waypoints: points.slice(1, -1).map((point) => ({ type: "via", ...at(...point) })) });
    expect(sharpTurns(route([[0, 0], [0, 2], [0.2, 4]]).geometry.coordinates)).toBe(0);
    expect(sharpTurns(route([[0, 0], [0, 2], [2, 2], [2, 0]]).geometry.coordinates)).toBe(2);
    expect(sharpTurns(line([[0, 0], [0, 1]]))).toBe(0);
  });

  it("counts short sideways hops as jogs, not bends or single corners", () => {
    const line = (points: Array<[number, number]>) => points.map(([n, e]) => [at(n, e).lon, at(n, e).lat] as [number, number]);
    expect(lateralJogs(line([[0, 0], [0, 1], [0.025, 1], [0.025, 2]]))).toBe(1);
    expect(lateralJogs(line([[0, 0], [0, 2], [0.2, 4]]))).toBe(0);
    expect(lateralJogs(line([[0, 0], [0, 1], [1, 1]]))).toBe(0);
  });
});

describe("generateRoute", () => {
  it("returns exactly one recommended route within the routing budget", async () => {
    const router = straightRouter();
    const { proposal, stops } = await generate({ targets: besideStart, flowlines: [highFlow], routing: router });
    expect(proposal.recommended).toBe(true);
    expect(stops.length).toBeGreaterThan(0);
    expect(router.calls.length).toBeLessThanOrEqual(PLANNING_LIMITS.maxRoutingRequests);
  });

  it("rides to a distant area and back on different sides instead of out and back", async () => {
    const routing = straightRouter();
    const input = { ...ride(), start: at(-30, 0), end: at(-30, 0) };
    const { proposal } = await generateRoute(
      { requestId: "req", playerId: "player", scopeId: "exploration", targets: [], flowlines: [], input, bounds },
      { routing, log: () => undefined }
    );
    expect(backtrackRatio(proposal.geometry.coordinates)).toBeLessThan(0.1);
    const there = proposal.waypoints![0];
    const back = proposal.waypoints![proposal.waypoints!.length - 1];
    expect(there.lat).toBeLessThan(bounds.minLatitude);
    expect(back.lat).toBeLessThan(bounds.minLatitude);
    expect(Math.sign(there.lon - input.start.lon)).toBe(-Math.sign(back.lon - input.start.lon));
    expect(routing.calls.length).toBeLessThanOrEqual(PLANNING_LIMITS.maxRoutingRequests);
  });

  it("tries tighter area loops when every first route bends out of the area", async () => {
    // Roads around wide loops leave the area; only loops close to the start stay inside it.
    const reachKm = (point: { lat: number; lon: number }) => Math.max(
      Math.abs(point.lat - at(0, 0).lat) / (at(1, 0).lat - at(0, 0).lat),
      Math.abs(point.lon - at(0, 0).lon) / (at(0, 1).lon - at(0, 0).lon)
    );
    const calls: RoutingRequest[] = [];
    const routing: RouteProvider = {
      route: async (request) => {
        calls.push(request);
        const route = straightLineRoute(request);
        if (request.waypoints.every((point) => reachKm(point) <= 2.5)) return route;
        const outside = [at(15, 15).lon, at(15, 15).lat] as [number, number];
        return { ...route, geometry: { ...route.geometry, coordinates: [route.geometry.coordinates[0], outside, ...route.geometry.coordinates.slice(1)] } };
      }
    };
    const { proposal } = await generate({ routing });
    expect(proposal.geometry.coordinates.every(([lon, lat]) => reachKm({ lat, lon }) <= 10)).toBe(true);
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.length).toBeLessThanOrEqual(PLANNING_LIMITS.maxRoutingRequests);
  });

  it("stops at helper points when passing them always leaves the area", async () => {
    const calls: RoutingRequest[] = [];
    const routing: RouteProvider = {
      route: async (request) => {
        calls.push(request);
        const route = straightLineRoute(request);
        if (request.waypoints.every((point) => point.type === "via")) return route;
        const outside = [at(15, 15).lon, at(15, 15).lat] as [number, number];
        return { ...route, geometry: { ...route.geometry, coordinates: [route.geometry.coordinates[0], outside, ...route.geometry.coordinates.slice(1)] } };
      }
    };
    const { proposal } = await generate({ routing });
    expect(proposal.geometry.coordinates.length).toBeGreaterThan(0);
    expect(calls.some((request) => request.waypoints.some((point) => point.type === "through"))).toBe(true);
    expect(calls.length).toBeLessThanOrEqual(PLANNING_LIMITS.maxRoutingRequests);
  });

  it("drops the helper point that ties a knot into the route", async () => {
    // Roads around helpers far east of the start force a small loop that crosses itself.
    const kmNorth = at(1, 0).lat - at(0, 0).lat;
    const kmEast = at(0, 1).lon - at(0, 0).lon;
    const knotted = (point: { lat: number; lon: number }) => point.lon > at(0, 0).lon + 3 * kmEast;
    const routing: RouteProvider = {
      route: async (request) => {
        const route = straightLineRoute(request);
        const knot = request.waypoints.find((point) => point.type === "through" && knotted(point));
        if (!knot) return route;
        const offset = (n: number, e: number) => [knot.lon + e * kmEast, knot.lat + n * kmNorth] as [number, number];
        const coordinates = [request.start, ...request.waypoints.slice(0, request.waypoints.indexOf(knot))]
          .map((point) => [point.lon, point.lat] as [number, number]);
        const rest = [...request.waypoints.slice(request.waypoints.indexOf(knot) + 1), request.end]
          .map((point) => [point.lon, point.lat] as [number, number]);
        const loop = [offset(0, 0), offset(0.3, 0.15), offset(0.3, -0.15), offset(-0.2, 0.15), offset(0, 0)];
        const geometry = straightLineRoute({ ...request, waypoints: [] }).geometry;
        return { ...route, geometry: { ...geometry, coordinates: [...coordinates, ...loop, ...rest] } };
      }
    };
    const { proposal } = await generate({ routing });
    expect(routeKnots(proposal.geometry.coordinates)).toHaveLength(0);
    expect(proposal.geometry.coordinates.length).toBeGreaterThan(2);
  });

  it("never zigzags out to far collectibles", async () => {
    const { proposal } = await generate({ targets: cornerCastles });
    expect(proposal.includedTargetIds).toEqual([]);
    expect(proposal.nearbyTargetIds).toEqual([]);
  });

  it("adds a few varied collectibles instead of every castle", async () => {
    const { proposal } = await generate({ targets: [...besideStart, ...cornerCastles] });
    const kinds = categories(proposal.includedTargetIds, besideStart);
    expect(proposal.includedTargetIds.length).toBeLessThanOrEqual(GENERATION_POLICY.pois.max);
    expect(kinds.filter((kind) => kind === "castle").length).toBeLessThanOrEqual(1);
    expect(proposal.includedTargetIds.some((id) => id.startsWith("castle-n") || id.startsWith("castle-s"))).toBe(false);
  });

  it("builds on the best-fitting Flowline with few planned collectibles", async () => {
    const lowFlow = scored("low-flow", [-2, -3], [-7, -3], { flow: 20, endurance: 30, explore: 30, roadQuality: 30 });
    const { proposal, stops } = await generate({ targets: besideStart, flowlines: [highFlow, lowFlow] });
    expect(proposal.traversedFlowlines.map((flowline) => flowline.id)).toContain("high-flow");
    expect(proposal.traversedFlowlines.map((flowline) => flowline.id)).not.toContain("low-flow");
    expect(stops.filter((stop) => stop.targetId.startsWith("castle") || stop.targetId === "peak" || stop.targetId === "viewpoint").length)
      .toBeLessThanOrEqual(GENERATION_POLICY.pois.max);
  });

  it("never follows Flowlines for running", async () => {
    const { proposal } = await generate({ flowlines: [highFlow], sport: "running" });
    expect(proposal.traversedFlowlines).toEqual([]);
  });

  it("drops an unroutable collectible and still returns a route", async () => {
    const blocked = besideStart[3].coordinate;
    const routing: RouteProvider = {
      route: async (request) => {
        const index = request.waypoints.findIndex((waypoint) =>
          Math.abs(waypoint.lat - blocked.lat) < 1e-5 && Math.abs(waypoint.lon - blocked.lon) < 1e-5);
        if (index >= 0) throw new RoutingError("point_not_routable", "Routing failed.", index + 1);
        return straightLineRoute(request);
      }
    };
    const { proposal } = await generate({ targets: besideStart, routing });
    expect(proposal.includedTargetIds).not.toContain("peak");
  });

  it("reports routing outages with a stable code", async () => {
    const down: RouteProvider = { route: async () => { throw new RoutingError("unavailable", "down"); } };
    await expect(generate({ targets: besideStart, routing: down })).rejects.toMatchObject({ code: "routing_unavailable" });
  });

  it("is deterministic for identical inputs", async () => {
    const strip = async () => {
      const { proposal: { id: _id, ...rest }, stops } = await generate({ targets: besideStart, flowlines: [highFlow] });
      return { rest, stops };
    };
    expect(await strip()).toEqual(await strip());
  });
});
