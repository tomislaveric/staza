import { describe, expect, it } from "vitest";
import { UserInputError } from "../errors.js";
import { DEFAULT_ROUTE_INTENT, flowlineFit, intentLengthMeters, parseRouteIntent, poiValue, sharpTurns, type RouteIntent } from "./intent.js";
import { generateIntentRoute } from "./intentPlanner.js";
import type { RouteProvider } from "./planner.js";
import { PLANNING_LIMITS } from "./policy.js";
import { RoutingError } from "./routingClient.js";
import { at, flowlineGeometry, pointTarget, straightLineRoute } from "./testFixtures.js";
import type { FlowlineGeometry, QuestRouteTarget, RoutePlanningInput, RoutingRequest } from "./types.js";

const sw = at(-10, -10);
const ne = at(10, 10);
const bounds = { minLatitude: sw.lat, maxLatitude: ne.lat, minLongitude: sw.lon, maxLongitude: ne.lon };
const AREA_METERS = 56_000;

const ride = (intent: RouteIntent, sport: RoutePlanningInput["sport"] = "cycling"): RoutePlanningInput => ({
  start: at(0, 0),
  end: at(0, 0),
  routeType: "round_trip",
  sport,
  constraint: { type: "distance", meters: intentLengthMeters(AREA_METERS, intent) }
});

const straightRouter = (): RouteProvider & { calls: RoutingRequest[] } => {
  const calls: RoutingRequest[] = [];
  return { calls, route: async (request) => { calls.push(request); return straightLineRoute(request); } };
};

const generate = (
  intent: RouteIntent,
  { targets = [], flowlines = [], routing = straightRouter(), sport }: {
    targets?: QuestRouteTarget[];
    flowlines?: FlowlineGeometry[];
    routing?: RouteProvider;
    sport?: RoutePlanningInput["sport"];
  } = {}
) => generateIntentRoute(
  { requestId: "req", playerId: "player", scopeId: "exploration", intent, targets, flowlines, input: ride(intent, sport), bounds },
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

describe("route intents", () => {
  it("defaults to Chill and rejects unknown intents", () => {
    expect(parseRouteIntent(undefined)).toBe(DEFAULT_ROUTE_INTENT);
    expect(DEFAULT_ROUTE_INTENT).toBe("chill");
    expect(parseRouteIntent("explore")).toBe("explore");
    expect(() => parseRouteIntent("fast")).toThrow(UserInputError);
  });

  it("caps the area-derived length per intent, Chill shortest", () => {
    expect(intentLengthMeters(AREA_METERS, "chill")).toBeLessThan(intentLengthMeters(AREA_METERS, "flow"));
    expect(intentLengthMeters(AREA_METERS, "explore")).toBe(AREA_METERS);
    expect(intentLengthMeters(300_000, "chill")).toBe(50_000);
    expect(intentLengthMeters(300_000, "flow")).toBe(120_000);
  });

  it("values variety over more of the same category", () => {
    const [castle1, castle2] = besideStart;
    const peak = besideStart[3];
    expect(poiValue([castle1, castle2])).toBeLessThan(poiValue([castle1, peak]));
    expect(poiValue([castle1, { ...castle2, alreadyAchieved: true }])).toBeLessThan(poiValue([castle1, castle2]));
  });

  it("ranks Flowlines by the intent's ride style", () => {
    const explorative = scored("explorative", [0, 0], [1, 0], { flow: 30, endurance: 40, explore: 95, roadQuality: 60 });
    expect(flowlineFit(highFlow, "flow")).toBeGreaterThan(flowlineFit(explorative, "flow"));
    expect(flowlineFit(explorative, "explore")).toBeGreaterThan(flowlineFit(highFlow, "explore"));
    expect(flowlineFit({ ...highFlow, completed: true }, "flow")).toBeLessThan(flowlineFit(highFlow, "flow"));
  });

  it("counts sharp turns, not gentle bends", () => {
    const line = (points: Array<[number, number]>) => points.map(([n, e]) => [at(n, e).lon, at(n, e).lat] as [number, number]);
    const route = (points: Array<[number, number]>) =>
      straightLineRoute({ profile: "bicycle", start: at(...points[0]), end: at(...points.at(-1)!), waypoints: points.slice(1, -1).map((point) => ({ type: "via", ...at(...point) })) });
    expect(sharpTurns(route([[0, 0], [0, 2], [0.2, 4]]).geometry.coordinates)).toBe(0);
    expect(sharpTurns(route([[0, 0], [0, 2], [2, 2], [2, 0]]).geometry.coordinates)).toBe(2);
    expect(sharpTurns(line([[0, 0], [0, 1]]))).toBe(0);
  });
});

describe("generateIntentRoute", () => {
  it("returns exactly one recommended route within the routing budget", async () => {
    for (const intent of ["flow", "chill", "explore"] as const) {
      const router = straightRouter();
      const { proposal, stops } = await generate(intent, { targets: besideStart, flowlines: [highFlow], routing: router });
      expect(proposal.recommended).toBe(true);
      expect(stops.length).toBeGreaterThan(0);
      expect(router.calls.length).toBeLessThanOrEqual(PLANNING_LIMITS.maxRoutingRequests);
    }
  });

  it("never zigzags Explore routes out to far collectibles", async () => {
    const { proposal } = await generate("explore", { targets: cornerCastles });
    expect(proposal.includedTargetIds).toEqual([]);
    expect(proposal.nearbyTargetIds).toEqual([]);
  });

  it("gives Explore a few varied collectibles instead of every castle", async () => {
    const { proposal } = await generate("explore", { targets: [...besideStart, ...cornerCastles] });
    const kinds = categories([...proposal.includedTargetIds, ...proposal.nearbyTargetIds], besideStart);
    expect(new Set(kinds).size).toBeGreaterThanOrEqual(2);
    expect(kinds.filter((kind) => kind === "castle").length).toBeLessThanOrEqual(2);
    expect(proposal.includedTargetIds.some((id) => id.startsWith("castle-n") || id.startsWith("castle-s"))).toBe(false);
  });

  it("builds Flow routes on the best-fitting Flowline with at most one planned collectible", async () => {
    const lowFlow = scored("low-flow", [-2, -3], [-7, -3], { flow: 20, endurance: 30, explore: 30, roadQuality: 30 });
    const { proposal, stops } = await generate("flow", { targets: besideStart, flowlines: [highFlow, lowFlow] });
    expect(proposal.traversedFlowlines.map((flowline) => flowline.id)).toContain("high-flow");
    expect(proposal.traversedFlowlines.map((flowline) => flowline.id)).not.toContain("low-flow");
    expect(stops.filter((stop) => !stop.targetId.startsWith("waypoint:")).length).toBeLessThanOrEqual(1);
  });

  it("keeps Chill shorter with fewer planned collectibles than Explore", async () => {
    const chill = await generate("chill", { targets: besideStart, flowlines: [highFlow] });
    const explore = await generate("explore", { targets: besideStart, flowlines: [highFlow] });
    const planned = (entry: typeof chill) => entry.stops.filter((stop) => !stop.targetId.startsWith("waypoint:")).length;
    expect(chill.proposal.distanceM).toBeLessThan(explore.proposal.distanceM);
    expect(planned(chill)).toBeLessThanOrEqual(planned(explore));
  });

  it("never follows Flowlines for running", async () => {
    const { proposal } = await generate("flow", { flowlines: [highFlow], sport: "running" });
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
    const { proposal } = await generate("explore", { targets: besideStart, routing });
    expect(proposal.includedTargetIds).not.toContain("peak");
  });

  it("reports routing outages with a stable code", async () => {
    const down: RouteProvider = { route: async () => { throw new RoutingError("unavailable", "down"); } };
    await expect(generate("chill", { targets: besideStart, routing: down })).rejects.toMatchObject({ code: "routing_unavailable" });
  });

  it("is deterministic for identical inputs", async () => {
    const strip = async () => {
      const { proposal: { id: _id, ...rest }, stops } = await generate("explore", { targets: besideStart, flowlines: [highFlow] });
      return { rest, stops };
    };
    expect(await strip()).toEqual(await strip());
  });
});
