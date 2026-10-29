import { describe, expect, it } from "vitest";
import type { NewPlannedRoute, WorldCollectible, WorldFartlek } from "../domain.js";
import { UserInputError } from "../errors.js";
import type { RouteProvider } from "../routePlanning/planner.js";
import { PLANNING_LIMITS } from "../routePlanning/policy.js";
import { ProposalStore } from "../routePlanning/proposalStore.js";
import { buildExplorationTargets, buildFlowlineGeometries, MAX_AVAILABLE_TARGETS } from "../routePlanning/targets.js";
import { at, flowlineGeometry, pointTarget, straightLineRoute } from "../routePlanning/testFixtures.js";
import { buildGpx, gpxFilename } from "./gpx.js";
import { describeExploration, explorationObjectives } from "./objectives.js";
import { parseGenerateRequest, parseRerouteRequest } from "./request.js";
import { ExplorationService, type NewExploration } from "./service.js";
import { ExplorationSessionStore } from "./sessionStore.js";
import type { ExplorationAreaContext } from "./types.js";

const area: ExplorationAreaContext = {
  bounds: { minLatitude: at(-10, 0).lat, maxLatitude: at(10, 0).lat, minLongitude: at(0, -10).lon, maxLongitude: at(0, 10).lon },
  center: at(0, 0),
  zoom: 11
};
const roundTripInput = { start: at(0, 0), end: at(0, 0), routeType: "round_trip" as const, constraint: { type: "distance" as const, meters: 40_000 } };
const bbox = `${area.bounds.minLongitude},${area.bounds.minLatitude},${area.bounds.maxLongitude},${area.bounds.maxLatitude}`;

const collectible = (id: string, northKm: number, eastKm: number, overrides: Partial<WorldCollectible> = {}): WorldCollectible => {
  const point = at(northKm, eastKm);
  return {
    id,
    name: id,
    type: "landmark",
    latitude: point.lat,
    longitude: point.lon,
    radiusMeters: 100,
    value: 10,
    primaryCategory: "place",
    found: false,
    visibility: "visible",
    ...overrides
  };
};

const flowline = (id: string, from: [number, number], to: [number, number], overrides: Partial<WorldFartlek> = {}): WorldFartlek => {
  const geometry = flowlineGeometry(id, from, to);
  return {
    id,
    name: id,
    geometry: { type: "LineString", coordinates: geometry.coordinates },
    lengthMeters: geometry.lengthMeters,
    status: "published",
    source: { sourceType: "test", sourceExternalId: id },
    completed: false,
    completionCount: 0,
    ...overrides
  } as WorldFartlek;
};

describe("buildExplorationTargets", () => {
  it("keeps published, visible, categorized collectibles as destinations and never Flowlines", () => {
    const { targets, truncated } = buildExplorationTargets([
      collectible("ok", 1, 1, { found: true }),
      collectible("hidden", 1, 1, { visibility: "hidden" }),
      collectible("draft", 1, 1, { status: "archived" }),
      collectible("coin", 1, 1, { primaryCategory: undefined })
    ]);
    expect(truncated).toBe(false);
    expect(targets.map((target) => [target.id, target.alreadyAchieved])).toEqual([["ok", true]]);
  });

  it("keeps only published Flowlines with valid geometry for route analysis", () => {
    const geometries = buildFlowlineGeometries([
      flowline("flow", [1, 0], [2, 0]),
      flowline("unpublished", [1, 0], [2, 0], { status: "archived" })
    ]);
    expect(geometries.map((geometry) => geometry.id)).toEqual(["flow"]);
  });

  it("caps very dense areas and reports truncation", () => {
    const many = Array.from({ length: MAX_AVAILABLE_TARGETS + 5 }, (_value, index) => collectible(`c${index}`, 0, 0));
    const result = buildExplorationTargets(many);
    expect(result.truncated).toBe(true);
    expect(result.targets).toHaveLength(MAX_AVAILABLE_TARGETS);
  });
});

describe("exploration objectives", () => {
  it("requires every destination, grouped by collectible category, and never Flowlines", () => {
    const targets = [
      pointTarget("p1", "", 1, 1, { category: "peak" }),
      pointTarget("c1", "", 2, 1),
      pointTarget("c2", "", 2, 2)
    ];
    expect(explorationObjectives(targets)).toEqual([
      { id: "collectibles-peak", type: "collectible_targets", requiredCount: 1, category: "peak", targets: [{ id: "p1", name: "p1" }] },
      { id: "collectibles-place", type: "collectible_targets", requiredCount: 2, category: "place", targets: [{ id: "c1", name: "c1" }, { id: "c2", name: "c2" }] }
    ]);
    expect(describeExploration(targets)).toEqual({ title: "Exploration: p1, c1 +1", description: "Visit 1 Peak, 2 Places." });
  });
});

describe("ExplorationSessionStore", () => {
  const session = (playerId: string) => ({
    playerId, area, input: roundTripInput, availableTargets: [], collectibles: [], flowlines: [], flowlineGeometries: [], truncated: false
  });

  it("keeps one session per player, scopes access and expires idle sessions", () => {
    let now = 0;
    const store = new ExplorationSessionStore(() => now, 1_000, 100);
    const first = store.create(session("p1"));
    expect(store.get("p2", first.id)).toBeUndefined();
    const second = store.create(session("p1"));
    expect(store.get("p1", first.id)).toBeUndefined();
    now = 999;
    expect(store.get("p1", second.id)).toBeDefined();
    now = 1_998;
    expect(store.get("p1", second.id)).toBeDefined();
    now = 2_998;
    expect(store.get("p1", second.id)).toBeUndefined();
    expect(store.size).toBe(0);
  });
});

describe("exploration requests", () => {
  const ride = { start: at(0, 0), routeType: "round_trip", constraint: { type: "distance", value: 40_000 } };

  it("freezes the area with the ride and never accepts targets", () => {
    const parsed = parseGenerateRequest({ area: { bbox, center: area.center, zoom: 11 }, ...ride, targetIds: ["x"] });
    expect(parsed.area.bounds).toEqual(area.bounds);
    expect(parsed.input.constraint).toEqual({ type: "distance", meters: 40_000 });
    const derived = parseGenerateRequest({ area: { bbox, center: area.center, zoom: 11 }, start: at(0, 0) });
    expect(derived.input.routeType).toBe("round_trip");
    expect(derived.input.constraint.type === "distance" && derived.input.constraint.meters).toBeGreaterThan(40_000);
    expect(parsed).not.toHaveProperty("targetIds");
    expect(() => parseGenerateRequest({ area: { bbox: "0,0,5,5", center: area.center, zoom: 5 }, ...ride })).toThrow(UserInputError);
    expect(() => parseGenerateRequest({ area: { bbox, center: area.center }, ...ride })).toThrow(UserInputError);
    expect(() => parseGenerateRequest({ area: { bbox, center: area.center, zoom: 11 } })).toThrow(UserInputError);
  });

  it("accepts a bounded, de-duplicated target list for rerouting", () => {
    const proposalId = "0b8f1c1e-3c3a-4c1e-9f5e-1c2d3e4f5a6b";
    expect(parseRerouteRequest({ proposalId, targetIds: ["a", "b", "a"] })).toEqual({ proposalId, targetIds: ["a", "b"], waypoints: [] });
    expect(() => parseRerouteRequest({ proposalId, targetIds: [] })).toThrow(UserInputError);
    expect(() => parseRerouteRequest({ proposalId, targetIds: [1] })).toThrow(UserInputError);
    expect(() => parseRerouteRequest({ proposalId: "nope", targetIds: ["a"] })).toThrow(UserInputError);
    const tooMany = Array.from({ length: PLANNING_LIMITS.maxRouteTargets + 1 }, (_value, index) => `t${index}`);
    expect(() => parseRerouteRequest({ proposalId, targetIds: tooMany })).toThrow(UserInputError);
  });
});

describe("ExplorationService", () => {
  const worldCollectibles = [
    collectible("c-near", 1, 1),
    collectible("c-mid", -2, 2, { primaryCategory: "peak" }),
    collectible("c-east", 0, 4),
    collectible("c-far", 9, 9)
  ];
  const worldFlowlines = [flowline("f-near", [2, 0], [3, 0]), flowline("f-west", [0, -2], [0, -4]), flowline("f-east", [0.2, 0.2], [0.8, 0.8])];

  const setup = (options: { routing?: RouteProvider | null; collectibles?: WorldCollectible[] } = {}) => {
    const created: Array<{ playerId: string; exploration: NewExploration; route: NewPlannedRoute }> = [];
    const routeCalls: unknown[] = [];
    const routing = options.routing === null
      ? undefined
      : options.routing ?? { route: async (request) => { routeCalls.push(request); return straightLineRoute(request); } };
    const service = new ExplorationService({
      loadArea: async () => ({
        collectibles: options.collectibles ?? worldCollectibles,
        flowlines: options.collectibles ? [] : worldFlowlines,
        truncated: false
      }),
      ...(routing ? { routing } : {}),
      sessions: new ExplorationSessionStore(),
      proposals: new ProposalStore(),
      explorations: {
        createExploration: async (playerId, exploration, route) => {
          const existing = created.find((entry) => entry.exploration.proposalId === exploration.proposalId);
          if (existing) return `instance-${existing.exploration.proposalId}`;
          created.push({ playerId, exploration, route });
          return `instance-${exploration.proposalId}`;
        }
      },
      log: () => undefined
    });
    return { service, created, routeCalls };
  };
  const generateBody = {
    area: { bbox, center: area.center, zoom: 11 },
    start: at(0, 0),
    routeType: "round_trip",
    constraint: { type: "distance", value: 30_000 }
  };
  const contents = (proposal: { includedTargetIds: string[]; nearbyTargetIds: string[] }) =>
    [...proposal.includedTargetIds, ...proposal.nearbyTargetIds];

  it("generates route proposals from the ride alone, with the area catalog and no persistence", async () => {
    const { service, created } = setup();
    const result = await service.generate("p1", generateBody);
    expect(result.proposals.length).toBeGreaterThan(0);
    expect(result.proposals.filter((proposal) => proposal.recommended)).toHaveLength(1);
    expect(result.proposals[0]).not.toHaveProperty("score");
    expect(result.proposals[0]).not.toHaveProperty("stops");
    expect(result.catalog.collectibles.map((item) => item.id)).toEqual(["c-near", "c-mid", "c-east", "c-far"]);
    expect(result.catalog.flowlines.map((item) => item.id)).toEqual(["f-near", "f-west", "f-east"]);
    expect(result.limits.maxRouteTargets).toBe(PLANNING_LIMITS.maxRouteTargets);
    const catalogIds = new Set(["c-near", "c-mid", "c-east", "c-far"]);
    for (const proposal of result.proposals) expect(contents(proposal).every((id) => catalogIds.has(id))).toBe(true);
    expect(created).toHaveLength(0);
  });

  it("reports Flowlines a route rides as derived metadata, never as targets", async () => {
    const { service, routeCalls } = setup();
    const { proposals } = await service.generate("p1", generateBody);
    const eastRoutes = proposals.filter((proposal) => contents(proposal).includes("c-near"));
    expect(eastRoutes.length).toBeGreaterThan(0);
    for (const proposal of eastRoutes) expect(proposal.traversedFlowlines.map((flowline) => flowline.id)).toContain("f-east");
    for (const proposal of proposals) {
      expect(proposal.targetSummary).not.toHaveProperty("flowlines");
      expect(proposal.traversedFlowlines.map((flowline) => flowline.id)).not.toContain("f-west");
    }
    expect(JSON.stringify(routeCalls)).not.toContain('"through"');
  });

  it("reports empty areas and missing routing with stable codes", async () => {
    await expect(setup({ collectibles: [collectible("hidden", 1, 1, { visibility: "hidden" })] }).service.generate("p1", generateBody))
      .rejects.toMatchObject({ code: "no_targets" });
    await expect(setup({ routing: null }).service.generate("p1", generateBody)).rejects.toMatchObject({ code: "planning_unavailable" });
  });

  it("reroutes one proposal for an edited target set without touching the others", async () => {
    const { service } = setup();
    const { explorationId, proposals } = await service.generate("p1", generateBody);
    const base = proposals.find((proposal) => proposal.recommended)!;
    const removed = contents(base)[0];
    const added = ["c-near", "c-mid", "c-east", "c-far"].find((id) => !contents(base).includes(id))!;
    const edited = [...contents(base).filter((id) => id !== removed), added];
    const { proposal } = await service.reroute("p1", explorationId, { proposalId: base.id, targetIds: edited });
    expect(proposal).toMatchObject({ customized: true, basedOn: base.id, label: base.label });
    expect(proposal.id).not.toBe(base.id);
    expect(new Set(contents(proposal))).toEqual(new Set(edited));
    expect(contents(proposal)).not.toContain(removed);
    for (const other of proposals) {
      expect(await service.confirm("p1", { proposalId: other.id })).toBe(`instance-${other.id}`);
    }
  });

  it("rejects targets outside the frozen area and foreign or expired proposals", async () => {
    const { service } = setup();
    const { explorationId, proposals } = await service.generate("p1", generateBody);
    const base = proposals[0];
    await expect(service.reroute("p1", explorationId, { proposalId: base.id, targetIds: ["elsewhere"] })).rejects.toBeInstanceOf(UserInputError);
    await expect(service.reroute("p1", explorationId, { proposalId: base.id, targetIds: ["f-east"] })).rejects.toBeInstanceOf(UserInputError);
    await expect(service.reroute("p2", explorationId, { proposalId: base.id, targetIds: ["c-near"] }))
      .rejects.toMatchObject({ code: "exploration_expired" });
    const next = await service.generate("p1", generateBody);
    await expect(service.reroute("p1", explorationId, { proposalId: base.id, targetIds: ["c-near"] }))
      .rejects.toMatchObject({ code: "exploration_expired" });
    await expect(service.reroute("p1", next.explorationId, { proposalId: base.id, targetIds: ["c-near"] }))
      .rejects.toMatchObject({ code: "proposal_expired" });
    await expect(service.confirm("p1", { proposalId: base.id })).rejects.toMatchObject({ code: "proposal_expired" });
  });

  it("confirms one exploration with objectives derived from the route contents, idempotently", async () => {
    const { service, created } = setup();
    const { explorationId, proposals } = await service.generate("p1", generateBody);
    const { proposal } = await service.reroute("p1", explorationId, { proposalId: proposals[0].id, targetIds: ["c-near", "c-mid"] });

    await expect(service.confirm("p2", { proposalId: proposal.id })).rejects.toMatchObject({ code: "proposal_expired" });
    const instanceId = await service.confirm("p1", { proposalId: proposal.id });
    expect(await service.confirm("p1", { proposalId: proposal.id })).toBe(instanceId);
    expect(created).toHaveLength(1);
    expect(created[0].exploration.proposalId).toBe(proposal.id);
    expect(created[0].exploration.objectives.map((objective) => objective.id)).toEqual(["collectibles-peak", "collectibles-place"]);
    expect(created[0].exploration.objectives.some((objective) => objective.type === "flowline_rule")).toBe(false);
    expect(created[0].exploration.objectives.every((objective) => objective.requiredCount === objective.targets.length)).toBe(true);
    expect(created[0].route).toMatchObject({ proposalId: proposal.id, geometry: proposal.geometry, includedTargetIds: proposal.includedTargetIds });
  });
});

describe("ExplorationService outings", () => {
  const near = [collectible("n1", 3, 1), collectible("n2", -2, 2, { primaryCategory: "peak" })];
  const ring = [collectible("r1", 24, 0), collectible("r2", 0, 24), collectible("r3", -24, 0), collectible("r4", 0, -24), collectible("r5", 17, 17), collectible("r6", -17, 17)];
  const inBounds = (item: WorldCollectible, bounds: { minLatitude: number; maxLatitude: number; minLongitude: number; maxLongitude: number }) =>
    item.latitude >= bounds.minLatitude && item.latitude <= bounds.maxLatitude
    && item.longitude >= bounds.minLongitude && item.longitude <= bounds.maxLongitude;

  const setup = (world: WorldCollectible[], route: RouteProvider["route"] = async (request) => straightLineRoute(request)) => {
    const requests: unknown[] = [];
    const created: Array<{ route: NewPlannedRoute }> = [];
    const service = new ExplorationService({
      loadArea: async (_playerId, bounds) => ({ collectibles: world.filter((item) => inBounds(item, bounds)), flowlines: [], truncated: false }),
      routing: { route: async (request, options) => { requests.push(request); return route(request, options); } },
      sessions: new ExplorationSessionStore(),
      proposals: new ProposalStore(),
      explorations: { createExploration: async (_playerId, _exploration, plannedRoute) => { created.push({ route: plannedRoute }); return "instance"; } },
      log: () => undefined
    });
    return { service, requests, created };
  };
  const body = (distanceM: number, extra: Record<string, unknown> = {}) => ({
    area: { bbox, center: area.center, zoom: 11 },
    start: at(0, 0),
    routeType: "round_trip",
    constraint: { type: "distance", value: distanceM },
    ...extra
  });

  it("never offers destinations outside the frozen area", async () => {
    const leaky = new ExplorationService({
      loadArea: async () => ({ collectibles: [...near, ...ring], flowlines: [], truncated: false }),
      routing: { route: async (request) => straightLineRoute(request) },
      sessions: new ExplorationSessionStore(),
      proposals: new ProposalStore(),
      explorations: { createExploration: async () => "instance" },
      log: () => undefined
    });
    const result = await leaky.generate("p1", body(40_000));
    expect(result.catalog.collectibles.map((item) => item.id).sort()).toEqual(["n1", "n2"]);
  });

  it("rejects routes leaving the area, except the connector from an outside start", async () => {
    const detour: RouteProvider["route"] = async (request) => {
      const route = straightLineRoute(request);
      const out = [request.start.lon, at(0, 0).lat + 0.5] as [number, number];
      return { ...route, geometry: { type: "LineString", coordinates: [...route.geometry.coordinates, out, ...route.geometry.coordinates.slice(-1)] } };
    };
    await expect(setup(near, detour).service.generate("p1", body(20_000))).rejects.toMatchObject({ code: "no_route" });

    const outside = at(0, 12);
    const { service } = setup(near);
    const result = await service.generate("p1", body(20_000, { start: outside }));
    expect(result.proposals.length).toBeGreaterThan(0);
    const { maxLongitude } = area.bounds;
    for (const proposal of result.proposals) {
      const inside = proposal.geometry.coordinates.map(([lon]) => lon <= maxLongitude);
      const first = inside.indexOf(true);
      const last = inside.lastIndexOf(true);
      expect(inside.slice(first, last + 1).every(Boolean)).toBe(true);
    }
  });

  it("adds clicked map points as route-only waypoints", async () => {
    const { service, requests } = setup(near);
    const { explorationId, proposals } = await service.generate("p1", body(20_000));
    const base = proposals[0];
    const waypoint = at(-6, -6);
    const { proposal } = await service.reroute("p1", explorationId, { proposalId: base.id, targetIds: ["n1"], waypoints: [waypoint] });
    expect(JSON.stringify(requests.at(-1))).toContain(waypoint.lat.toFixed(6));
    expect(proposal.waypoints).toEqual([waypoint]);
    expect(proposal.includedTargetIds.concat(proposal.nearbyTargetIds).every((id) => !id.startsWith("waypoint:"))).toBe(true);
    expect(proposal.targetSummary).toEqual({ peaks: 0, places: 1, other: 0 });
    await expect(service.reroute("p1", explorationId, { proposalId: base.id, targetIds: ["n1"], waypoints: [at(0, 30)] }))
      .rejects.toBeInstanceOf(UserInputError);
  });

  it("reports an insufficient area instead of silently returning a much shorter route", async () => {
    const { service } = setup(near);
    const result = await service.generate("p1", body(100_000));
    expect(Math.max(...result.proposals.map((proposal) => proposal.distanceM))).toBeLessThan(40_000);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ code: "insufficient_area", requestedType: "distance", requested: 100_000 });
    expect(result.warnings[0].message).toContain("100 km");
  });

  it("closes round trips so the route ends at its start and the distance includes the closing leg", async () => {
    const open: RouteProvider["route"] = async (request) => {
      const route = straightLineRoute(request);
      const coordinates = route.geometry.coordinates.slice(0, -3);
      return { ...route, geometry: { type: "LineString", coordinates }, distanceM: route.distanceM - 150 };
    };
    const { service } = setup(near, open);
    const { proposals } = await service.generate("p1", body(20_000));
    for (const proposal of proposals) {
      expect(proposal.geometry.coordinates.at(-1)).toEqual([proposal.start.lon, proposal.start.lat]);
      expect(proposal.end).toEqual(proposal.start);
    }
  });

  it("routes running and hiking on foot, cycling by default, and persists the profile", async () => {
    const running = setup(near);
    const { proposals } = await running.service.generate("p1", body(20_000, { sport: "running" }));
    expect(running.requests.every((request) => (request as { profile: string }).profile === "pedestrian")).toBe(true);
    await running.service.confirm("p1", { proposalId: proposals[0].id });
    expect(running.created[0].route.profile).toBe("pedestrian");

    const cycling = setup(near);
    await cycling.service.generate("p1", body(20_000));
    expect(cycling.requests.every((request) => (request as { profile: string }).profile === "bicycle")).toBe(true);
    expect(() => parseGenerateRequest({ ...body(20_000, { sport: "swimming" }), area: { bbox, center: area.center, zoom: 11 } })).toThrow(UserInputError);
  });
});

describe("GPX export", () => {
  it("produces GPX 1.1 with escaped names and the full track", () => {
    const gpx = buildGpx({ name: `Tom & "Jerry" <loop>`, description: "A\u0000B", start: { lat: 46, lon: 15 }, coordinates: [[15, 46], [15.1, 46.1], [15, 46]] });
    expect(gpx).toContain('<gpx version="1.1" creator="Staza" xmlns="http://www.topografix.com/GPX/1/1"');
    expect(gpx).toContain("<name>Tom &amp; &quot;Jerry&quot; &lt;loop&gt;</name>");
    expect(gpx).toContain("<desc>AB</desc>");
    expect(gpx.match(/<trkpt /g)).toHaveLength(3);
    expect(gpx).toContain('<trkpt lat="46.1" lon="15.1"/>');
    expect(gpxFilename("Exploration: Tom & Jerry")).toBe("exploration-tom-jerry.gpx");
  });
});
