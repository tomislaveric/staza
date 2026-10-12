import { describe, expect, it, vi } from "vitest";
import { customizedStops, generateExplorationRoutes, PlanningError, rerouteTargets, type RouteProvider } from "./planner.js";
import { PLANNING_LIMITS } from "./policy.js";
import { constraintFitFlag, distinctRoutes, proposalHint, selectProposals } from "./proposals.js";
import { RoutingError } from "./routingClient.js";
import { buildStrategies, targetCountFor } from "./strategies.js";
import { at, flowlineGeometry, objectivesFor, pointTarget, straightLineRoute } from "./testFixtures.js";
import type { FlowlineGeometry, QuestRouteTarget, RouteCandidate, RoutePlanningInput, RoutingRequest, ScoredRoute } from "./types.js";
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

const generate = (targets: QuestRouteTarget[], input: RoutePlanningInput, routing: RouteProvider, flowlines: FlowlineGeometry[] = []) =>
  generateExplorationRoutes({ requestId: "req", playerId: "player", scopeId: "exploration", targets, flowlines, input }, { routing, log: () => undefined });

/** A varied area: Peaks, Places and a viewpoint spread around the start. */
const mixedArea = (): QuestRouteTarget[] => [
  pointTarget("p1", "", 4, 3, { category: "peak" }),
  pointTarget("p2", "", -4, -3, { category: "peak" }),
  pointTarget("pl1", "", 3, -4),
  pointTarget("pl2", "", -3, 4),
  pointTarget("pl3", "", 6, 1),
  pointTarget("v1", "", 1, 6, { category: "viewpoint" })
];

describe("internal target-selection strategies", () => {
  it("scales the target count with the ride budget", () => {
    expect(targetCountFor({ type: "distance", meters: 10_000 })).toBe(2);
    expect(targetCountFor({ type: "distance", meters: 48_000 })).toBe(4);
    expect(targetCountFor({ type: "distance", meters: 300_000 })).toBe(8);
    expect(targetCountFor({ type: "duration", seconds: 7_200 })).toBe(3);
  });

  it("builds peak-focused, balanced and discovery mixes from destinations only", () => {
    const strategies = buildStrategies(mixedArea(), { type: "distance", meters: 72_000 });
    expect(strategies.map((strategy) => strategy.name)).toEqual(["balanced", "peak_focus", "discovery"]);
    const required = (name: string, id: string) =>
      strategies.find((strategy) => strategy.name === name)!.objectives.find((objective) => objective.id === id)?.requiredCount ?? 0;
    expect(required("peak_focus", "peak")).toBeGreaterThanOrEqual(required("discovery", "peak"));
    for (const strategy of strategies) {
      expect(strategy.objectives.every((objective) => objective.type === "collectible_targets")).toBe(true);
      const total = strategy.objectives.reduce((sum, objective) => sum + objective.requiredCount, 0);
      expect(total).toBe(6);
      const peak = strategy.targets.find((target) => target.id === "p1")!;
      expect(peak.objectiveIds.every((id) => strategy.objectives.some((objective) => objective.id === id))).toBe(true);
    }
  });

  it("redistributes kinds the area lacks and drops identical mixes", () => {
    const placesOnly = [pointTarget("a", "", 1, 0), pointTarget("b", "", 0, 1), pointTarget("c", "", -1, 0)];
    const strategies = buildStrategies(placesOnly, { type: "distance", meters: 36_000 });
    expect(strategies.length).toBeGreaterThan(0);
    for (const strategy of strategies) {
      expect(strategy.objectives.every((objective) => objective.type === "collectible_targets")).toBe(true);
      expect(strategy.objectives.reduce((sum, objective) => sum + objective.requiredCount, 0)).toBe(3);
    }
  });
});

describe("generateExplorationRoutes", () => {
  it("returns distinct, labelled proposals with route contents within the routing budget", async () => {
    const router = straightRouter();
    const proposals = await generate(mixedArea(), roundTrip(48), router);
    expect(proposals.length).toBeGreaterThanOrEqual(2);
    expect(proposals.length).toBeLessThanOrEqual(PLANNING_LIMITS.maxProposals);
    expect(router.calls.length).toBeLessThanOrEqual(PLANNING_LIMITS.maxRoutingRequests);
    const labels = proposals.map(({ proposal }) => proposal.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(proposals.filter(({ proposal }) => proposal.recommended)).toHaveLength(1);
    for (const { proposal, stops } of proposals) {
      const contents = new Set([...proposal.includedTargetIds, ...proposal.nearbyTargetIds]);
      const summary = proposal.targetSummary;
      expect(summary.peaks + summary.places + summary.other).toBe(contents.size);
      expect(contents.size).toBeGreaterThan(0);
      expect(stops.length).toBeGreaterThan(0);
      expect(["within", "short", "long"]).toContain(proposal.constraintFit);
    }
  });

  it("lets proposals contain different target subsets", async () => {
    const proposals = await generate(mixedArea(), roundTrip(48), straightRouter());
    const sets = proposals.map(({ proposal }) => [...proposal.includedTargetIds, ...proposal.nearbyTargetIds].sort().join(","));
    expect(new Set(sets).size).toBe(sets.length);
  });

  it("prefers compact loops when targets surround the start over a linear layout", async () => {
    const surrounding = [pointTarget("n", "", 5, 0), pointTarget("e", "", 0, 5), pointTarget("s", "", -5, 0), pointTarget("w", "", 0, -5)];
    const linear = [pointTarget("a", "", 0, 3), pointTarget("b", "", 0, 6), pointTarget("c", "", 0, 9), pointTarget("d", "", 0, 12)];
    const best = async (targets: QuestRouteTarget[]) => Math.max(...(await generate(targets, roundTrip(30), straightRouter()))
      .map(({ proposal }) => proposal.score.loopQuality));
    expect(await best(surrounding)).toBeGreaterThan(await best(linear));
  });

  it("isolates a failing candidate", async () => {
    let calls = 0;
    const routing: RouteProvider = {
      route: async (request) => {
        calls += 1;
        if (calls === 1) throw new RoutingError("no_route", "Routing failed (no_route).");
        return straightLineRoute(request);
      }
    };
    expect((await generate(mixedArea(), roundTrip(40), routing)).length).toBeGreaterThan(0);
  });

  it("drops an unroutable Peak and retries without it", async () => {
    const targets = [pointTarget("peak", "", 3, 3, { category: "peak" }), pointTarget("c1", "", 2, -2), pointTarget("c2", "", -2, 2)];
    const peak = at(3, 3);
    const routing: RouteProvider = {
      route: async (request) => {
        const index = request.waypoints.findIndex((waypoint) =>
          Math.abs(waypoint.lat - peak.lat) < 1e-5 && Math.abs(waypoint.lon - peak.lon) < 1e-5);
        if (index >= 0) throw new RoutingError("snap_distance_exceeded", "Routing failed (snap_distance_exceeded).", index + 1);
        return straightLineRoute(request);
      }
    };
    const proposals = await generate(targets, roundTrip(20), routing);
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.every(({ proposal }) => !proposal.includedTargetIds.includes("peak"))).toBe(true);
  });

  it("is deterministic for identical inputs", async () => {
    const strip = (proposals: Awaited<ReturnType<typeof generate>>) => proposals.map(({ proposal: { id: _id, ...rest }, stops }) => ({ rest, stops }));
    expect(strip(await generate(mixedArea(), roundTrip(40), straightRouter())))
      .toEqual(strip(await generate(mixedArea(), roundTrip(40), straightRouter())));
  });

  it("bounds routing requests even with many targets", async () => {
    const targets = Array.from({ length: 40 }, (_value, index) =>
      pointTarget(`t${String(index).padStart(2, "0")}`, "", Math.sin(index) * 8, Math.cos(index) * 8, { category: index % 3 === 0 ? "peak" : "place" }));
    const router = straightRouter();
    await generate(targets, roundTrip(60), router);
    expect(router.calls.length).toBeLessThanOrEqual(PLANNING_LIMITS.maxRoutingRequests);
    for (const request of router.calls) expect(request.waypoints.length).toBeLessThanOrEqual(48);
  });

  it("reports routing outages and unreachable areas with stable codes", async () => {
    const down: RouteProvider = { route: vi.fn(async () => { throw new RoutingError("unavailable", "down"); }) };
    await expect(generate(mixedArea(), roundTrip(40), down)).rejects.toMatchObject({ code: "routing_unavailable" });
    const error = await generate([pointTarget("far", "", 200, 0)], roundTrip(20), straightRouter()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PlanningError);
    expect(error).toMatchObject({ code: "no_reachable_targets" });
  });

  it("supports point-to-point routes", async () => {
    const targets = [pointTarget("mid", "", 0, 10), pointTarget("side", "", 2, 5)];
    const input: RoutePlanningInput = { start: at(0, 0), end: at(0, 20), routeType: "point_to_point", constraint: { type: "duration", seconds: 3_600 } };
    const [first] = await generate(targets, input, straightRouter());
    expect(first.proposal.routeType).toBe("point_to_point");
    expect(first.proposal.end).toEqual(at(0, 20));
  });
});

describe("traversed Flowlines", () => {
  const ridden = flowlineGeometry("ridden", [2, 0], [4, 0]);
  const elsewhere = flowlineGeometry("elsewhere", [-8, -8], [-9, -8]);
  const targets = [pointTarget("far", "", 5, 0), pointTarget("side", "", 0, -4)];

  it("reports Flowlines the final route rides and ignores the rest", async () => {
    const proposals = await generate(targets, roundTrip(24), straightRouter(), [ridden, elsewhere]);
    const withRidden = proposals.filter(({ proposal }) => proposal.includedTargetIds.includes("far"));
    expect(withRidden.length).toBeGreaterThan(0);
    for (const { proposal } of withRidden) {
      expect(proposal.traversedFlowlines).toEqual([{ id: "ridden", name: "ridden", lengthMeters: ridden.lengthMeters }]);
    }
    for (const { proposal } of proposals) expect(proposal.traversedFlowlines.map((flowline) => flowline.id)).not.toContain("elsewhere");
  });

  it("never lets Flowlines shape candidates, waypoints or proposals", async () => {
    const plain = straightRouter();
    const withFlowlines = straightRouter();
    const strip = (entries: Awaited<ReturnType<typeof generate>>) =>
      entries.map(({ proposal: { id: _id, traversedFlowlines: _along, ...rest }, stops }) => ({ rest, stops }));
    expect(strip(await generate(mixedArea(), roundTrip(40), withFlowlines, [ridden, elsewhere])))
      .toEqual(strip(await generate(mixedArea(), roundTrip(40), plain)));
    expect(withFlowlines.calls).toEqual(plain.calls);
    expect(withFlowlines.calls.every((call) => call.waypoints.every((waypoint) => waypoint.type === "via"))).toBe(true);
  });

  it("requires most of a Flowline to be covered and works without Flowlines", () => {
    const route = straightLineRoute({ profile: "bicycle", start: at(0, 0), end: at(0, 0), waypoints: [{ type: "via", ...at(5, 0) }] });
    expect(traversedFlowlines(route, [ridden, elsewhere]).map((flowline) => flowline.id)).toEqual(["ridden"]);
    expect(traversedFlowlines(route, [flowlineGeometry("crossing", [3, -1], [3, 1])])).toEqual([]);
    expect(traversedFlowlines(route, [])).toEqual([]);
  });
});

describe("proposal selection and labels", () => {
  const scored = (key: string, distanceKm: number, targetIds: string[], total: number): ScoredRoute => ({
    candidate: { key, stops: [], estimatedDistanceM: distanceKm * 1000, heuristicScore: 0, strategy: "minimal" } as RouteCandidate,
    routing: straightLineRoute({ profile: "bicycle", start: at(0, 0), end: at(0, 0), waypoints: [] }),
    includedTargetIds: targetIds,
    nearbyTargetIds: [],
    objectiveProgress: [],
    progressPotential: 1,
    score: { questProgress: 0, constraintFit: 0, loopQuality: 0, routeShape: 0, targetQuality: 0, detourPenalty: 0, total }
  });
  const withDistance = (route: ScoredRoute, km: number): ScoredRoute => ({ ...route, routing: { ...route.routing, distanceM: km * 1000 } });

  it("labels Quick, Balanced and Adventure relative to each other and recommends the best score", () => {
    const quick = withDistance(scored("q", 31, ["a", "b"], 0.6), 31);
    const balanced = withDistance(scored("b", 46, ["a", "c", "d", "e"], 0.9), 46);
    const adventure = withDistance(scored("a", 54, ["c", "f", "g", "h", "i", "j"], 0.7), 54);
    const selected = selectProposals([adventure, quick, balanced]);
    expect(selected.map(({ label, route }) => [label, route.candidate.key])).toEqual([["quick", "q"], ["balanced", "b"], ["adventure", "a"]]);
    expect(selected.filter(({ recommended }) => recommended).map(({ route }) => route.candidate.key)).toEqual(["b"]);
  });

  it("never returns near-duplicate routes", () => {
    const one = withDistance(scored("1", 40, ["a", "b", "c"], 0.9), 40);
    const same = withDistance(scored("2", 41, ["a", "b", "c"], 0.8), 41);
    expect(distinctRoutes(one, same)).toBe(false);
    expect(selectProposals([one, same])).toEqual([{ label: "balanced", route: one, recommended: true }]);
    expect(distinctRoutes(one, withDistance(scored("3", 41, ["d", "e", "c"], 0.8), 41))).toBe(true);
  });

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
