import { describe, expect, it } from "vitest";
import { buildRoutingPlan } from "./routingPlan.js";
import { distanceBetween } from "./geo.js";
import { ProposalStore } from "./proposalStore.js";
import { assertNearTargets, parseProposalId, parseRoutePlanningInput } from "./request.js";
import { constraintFit, isoperimetricQuotient, objectiveProgress, retraceRatio, scoreRoute } from "./scoring.js";
import { at, pointTarget, straightLineRoute, objectivesFor } from "./testFixtures.js";
import type { RouteProposal, RoutingResult } from "./types.js";

describe("scoring", () => {
  it("rewards the preferred band and penalizes overshoot and undershoot symmetrically", () => {
    expect(constraintFit(50_000, 50_000)).toBe(1);
    expect(constraintFit(45_500, 50_000)).toBe(1);
    expect(constraintFit(60_000, 50_000)).toBeCloseTo(0.5);
    expect(constraintFit(40_000, 50_000)).toBeCloseTo(0.5);
    expect(constraintFit(80_000, 50_000)).toBe(0);
  });

  it("prefers a 48 km route over an 80 km route for a 50 km request at equal progress", () => {
    const routing = (distanceM: number): RoutingResult => ({
      ...straightLineRoute({ profile: "bicycle", start: at(0, 0), end: at(0, 0), waypoints: [{ type: "via", ...at(5, 0) }, { type: "via", ...at(0, 5) }] }),
      distanceM
    });
    const target = pointTarget("t", "o", 5, 0);
    const score = (distanceM: number) => scoreRoute({
      routeType: "round_trip",
      constraint: { type: "distance", meters: 50_000 },
      routing: routing(distanceM),
      estimatedDistanceM: distanceM,
      progress: 1,
      includedTargets: [target]
    }).total;
    expect(score(48_000)).toBeGreaterThan(score(80_000));
  });

  it("detects out-and-back retracing and loop compactness", () => {
    const outAndBack = straightLineRoute({ profile: "bicycle", start: at(0, 0), end: at(0, 0), waypoints: [{ type: "via", ...at(5, 0) }] });
    const loop = straightLineRoute({ profile: "bicycle", start: at(0, 0), end: at(0, 0), waypoints: [
      { type: "via", ...at(3, 0) }, { type: "via", ...at(3, 3) }, { type: "via", ...at(0, 3) }
    ] });
    expect(retraceRatio(outAndBack.geometry.coordinates)).toBeGreaterThan(0.8);
    expect(retraceRatio(loop.geometry.coordinates)).toBeLessThan(0.1);
    expect(isoperimetricQuotient(loop.geometry.coordinates)).toBeGreaterThan(0.7);
    expect(isoperimetricQuotient(outAndBack.geometry.coordinates)).toBeLessThan(0.05);
  });

  it("caps objective progress at the required count", () => {
    const targets = [pointTarget("a", "o", 1, 0), pointTarget("b", "o", 2, 0), pointTarget("c", "o", 3, 0)];
    const progress = objectiveProgress(objectivesFor(targets, { o: 2 }), ["a", "b", "c"]);
    expect(progress.overall).toBe(1);
    expect(progress.objectives[0]).toMatchObject({ included: 3, required: 2, potential: 1 });
  });
});

describe("routing plan", () => {
  it("maps routing location indexes to destinations and uses via for every stop", () => {
    const first = pointTarget("p", "o", 1, 1);
    const second = pointTarget("q", "o", 2, 2);
    const plan = buildRoutingPlan(at(0, 0), at(0, 0), [{ target: first }, { target: second }]);
    expect(plan.request.waypoints).toHaveLength(2);
    expect(plan.request.waypoints.every((waypoint) => waypoint.type === "via")).toBe(true);
    expect(plan.waypointTargetIds.get(1)).toBe("p");
    expect(plan.waypointTargetIds.get(2)).toBe("q");
    expect(JSON.stringify(plan.request)).not.toContain("\"p\"");
  });
});

describe("request parsing", () => {
  const base = {
    routeType: "round_trip",
    start: { lat: 46, lon: 15 },
    constraint: { type: "distance", value: 50_000 }
  };

  it("accepts round trips and ignores a destination", () => {
    const parsed = parseRoutePlanningInput({ ...base, end: { lat: 47, lon: 16 } });
    expect(parsed.end).toEqual(parsed.start);
    expect(parsed.constraint).toEqual({ type: "distance", meters: 50_000 });
  });

  it("validates route type, coordinates and constraint bounds", () => {
    expect(() => parseRoutePlanningInput({ ...base, routeType: "loop" })).toThrow();
    expect(() => parseRoutePlanningInput({ ...base, start: { lat: 91, lon: 0 } })).toThrow();
    expect(() => parseRoutePlanningInput({ ...base, routeType: "point_to_point" })).toThrow();
    expect(() => parseRoutePlanningInput({ ...base, constraint: { type: "distance", value: 500_000 } })).toThrow();
    expect(() => parseRoutePlanningInput({ ...base, constraint: { type: "duration", value: 60 } })).toThrow();
    expect(parseRoutePlanningInput({ ...base, constraint: { type: "duration", value: 7_200 } }).constraint)
      .toEqual({ type: "duration", seconds: 7_200 });
  });

  it("rejects starts far from every exploration target", () => {
    const input = parseRoutePlanningInput(base);
    expect(() => assertNearTargets(input, [pointTarget("t", "o", 5, 5)])).not.toThrow();
    expect(() => assertNearTargets(input, [pointTarget("t", "o", 400, 0)])).toThrow();
  });

  it("parses proposal ids strictly", () => {
    expect(parseProposalId({ proposalId: "0b8f1c1e-3c3a-4c1e-9f5e-1c2d3e4f5a6b" })).toBe("0b8f1c1e-3c3a-4c1e-9f5e-1c2d3e4f5a6b");
    expect(() => parseProposalId({ proposalId: "nope" })).toThrow();
  });
});

describe("ProposalStore", () => {
  const proposal = (id: string, customized = false) => ({ id, customized } as RouteProposal);
  const entry = (id: string, customized = false) => ({ explorationId: "e", stops: [], targets: [], proposal: proposal(id, customized), plannerVersion: 3 });

  it("scopes proposals to their player, expires them and replaces earlier plans", () => {
    let now = 0;
    const store = new ProposalStore(() => now, 1_000, 100);
    store.replaceForPlayer("p1", [entry("a"), entry("b")]);
    expect(store.get("p1", "a")?.proposal.id).toBe("a");
    expect(store.get("p2", "a")).toBeUndefined();
    store.replaceForPlayer("p1", [entry("c")]);
    expect(store.get("p1", "a")).toBeUndefined();
    expect(store.get("p1", "c")).toBeDefined();
    now = 1_000;
    expect(store.get("p1", "c")).toBeUndefined();
  });

  it("adds customized routes next to the originals and evicts old customizations first", () => {
    const store = new ProposalStore(() => 0, 1_000, 100, 3);
    store.replaceForPlayer("p1", [entry("a"), entry("b")]);
    store.addForPlayer("p1", entry("a1", true));
    expect(store.get("p1", "a")).toBeDefined();
    expect(store.get("p1", "a1")).toBeDefined();
    store.addForPlayer("p1", entry("a2", true));
    expect(store.get("p1", "a1")).toBeUndefined();
    expect(store.get("p1", "a")).toBeDefined();
    expect(store.get("p1", "b")).toBeDefined();
    expect(store.get("p1", "a2")).toBeDefined();
    store.replaceForPlayer("p1", [entry("c")]);
    expect(store.get("p1", "a2")).toBeUndefined();
  });

  it("evicts the oldest entries beyond capacity", () => {
    const store = new ProposalStore(() => 0, 1_000, 2);
    store.replaceForPlayer("p1", [entry("a")]);
    store.replaceForPlayer("p2", [entry("b")]);
    store.replaceForPlayer("p3", [entry("c")]);
    expect(store.size).toBe(2);
    expect(store.get("p1", "a")).toBeUndefined();
  });
});
