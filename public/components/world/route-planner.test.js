import { describe, expect, it } from "vitest";
import {
  buildPlanRequest, buildSuggestRequest, canGenerate, collectibleStop, createPlannerState, flowlineStop, moveStop,
  orderStops, planArea, RoutePlannerPanel, suggestedStops, showsAim, toggleStop, waypointStop
} from "./route-planner.js";

const flowline = flowlineStop({ id: "f1", name: "Rheintal", geometry: { coordinates: [[9, 47], [9.1, 47.2]] } });
const peak = collectibleStop({ id: "peak-1", name: "Peak", type: "peak", latitude: 47.5, longitude: 9.5 });
const point = waypointStop({ lat: 47.1, lon: 9.05 });

describe("route planner stops", () => {
  it("toggles stops without a limit", () => {
    const stops = toggleStop([flowline], peak);
    expect(stops).toEqual([flowline, peak]);
    expect(toggleStop(stops, peak)).toEqual([flowline]);
  });

  it("applies the server's routed order and keeps unmentioned stops last", () => {
    expect(orderStops([flowline, peak, point], ["waypoint:47.100000,9.050000", "flowline:f1"])).toEqual([point, flowline, peak]);
    expect(moveStop([flowline, peak], 1, -1)).toEqual([peak, flowline]);
    expect(moveStop([flowline, peak], 0, -1)).toEqual([flowline, peak]);
    expect(moveStop([flowline], 1, -1)).toEqual([flowline]);
  });
});

describe("buildPlanRequest", () => {
  it("requires a start, an end for point-to-point and at least one stop", () => {
    expect(buildPlanRequest(createPlannerState()).error).toBe("Choose a start on the map.");
    const start = { lat: 47, lon: 9 };
    expect(buildPlanRequest(createPlannerState({ start })).error).toBe("Add a Flowline, collectible or map point first.");
    expect(buildPlanRequest({ ...createPlannerState({ start, stops: [peak] }), routeType: "point_to_point" }).error)
      .toBe("Choose an end point on the map.");
  });

  it("sends exactly the chosen stops inside a padded area around them", () => {
    const state = { ...createPlannerState({ start: { lat: 47, lon: 9 }, stops: [flowline, peak, point] }), keepOrder: true };
    const { body } = buildPlanRequest(state);
    expect(body).toEqual({
      area: planArea(state),
      sport: "cycling",
      start: { lat: 47, lon: 9 },
      routeType: "round_trip",
      keepOrder: true,
      stops: [{ kind: "flowline", id: "f1" }, { kind: "collectible", id: "peak-1" }, { kind: "waypoint", lat: 47.1, lon: 9.05 }]
    });
    const [west, south, east, north] = body.area.bbox.split(",").map(Number);
    expect(west).toBeLessThan(9);
    expect(south).toBeLessThan(47);
    expect(east).toBeGreaterThan(9.5);
    expect(north).toBeGreaterThan(47.5);
  });
});

describe("planner wizard", () => {
  const start = { lat: 47, lon: 9 };
  const aim = { lat: 47.1, lon: 9.1 };
  const route = (extra = {}) => ({ id: "p1", distanceM: 12000, durationS: 2400, geometry: { coordinates: [] }, ...extra });

  it("asks for sport and shape first, then generates once a start is known", () => {
    const state = createPlannerState({ start });
    expect(canGenerate(state)).toBe(false);
    const html = RoutePlannerPanel(state);
    expect(html).toContain('data-planner-sport="cycling" aria-pressed="false"');
    expect(html).toContain('data-planner-shape="round_trip"');
    expect(html).not.toContain("data-planner-add");
    const ready = { ...state, sportChosen: true, shapeChosen: true, stepsOpen: false };
    expect(canGenerate(ready)).toBe(true);
    expect(canGenerate({ ...ready, routeType: "point_to_point" })).toBe(true);
    expect(RoutePlannerPanel(ready)).toContain("data-planner-steps");
    expect(RoutePlannerPanel(ready)).not.toContain("data-planner-sport");
  });

  it("requests one route towards the aim, or the end of an A to B route", () => {
    const state = createPlannerState({ start, sport: "running", routeType: "round_trip" });
    expect(buildSuggestRequest(state, aim).body)
      .toEqual({ target: aim, sport: "running", start, routeType: "round_trip" });
    const end = { lat: 47.5, lon: 9.1 };
    expect(buildSuggestRequest({ ...state, routeType: "point_to_point", end }, aim).body)
      .toMatchObject({ routeType: "point_to_point", target: end });
    expect(buildSuggestRequest({ ...state, routeType: "point_to_point" }, aim).body)
      .toMatchObject({ routeType: "point_to_point", target: aim });
    expect(buildSuggestRequest(createPlannerState(), aim).error).toBe("Choose a start on the map.");
    expect(buildSuggestRequest(createPlannerState({ start, destination: aim, destinationId: "poi-1" }), aim).body)
      .toMatchObject({ target: aim, destinationId: "poi-1" });
  });

  it("shows the generated route's card above its editable stops", () => {
    const state = createPlannerState({ start, sport: "cycling", routeType: "round_trip" });
    expect(RoutePlannerPanel(state)).not.toContain("data-planner-save");
    const generated = RoutePlannerPanel({ ...state, generated: true, proposal: route(), stops: [peak], stopsAreSuggested: true });
    expect(generated).toContain("Baseline route");
    expect(generated).not.toContain("Edited");
    expect(generated.indexOf("data-planner-save")).toBeLessThan(generated.indexOf('data-planner-stop="peak-1"'));
    expect(generated).toContain("data-planner-add");
    expect(RoutePlannerPanel({ ...state, generated: true, stops: [peak] })).toContain("Edited");
  });

  it("turns a route's collectibles and unridden Flowlines into stops", () => {
    const catalog = {
      collectibles: [{ id: "peak-1", name: "Peak", type: "peak", latitude: 47.5, longitude: 9.5 }],
      flowlines: [{ id: "f1", name: "Rheintal", geometry: { coordinates: [[9, 47]] } }, { id: "done", completed: true }]
    };
    const stops = suggestedStops(route({ includedTargetIds: ["peak-1"], traversedFlowlines: [{ id: "f1" }, { id: "f1" }, { id: "done" }] }), catalog);
    expect(stops.map((stop) => stop.id)).toEqual(["peak-1"]);
  });

  it("shows optional Flowlines and actual cumulative deltas separately from baseline stops", () => {
    const state = {
      ...createPlannerState({ start, sport: "cycling", routeType: "round_trip" }),
      generated: true,
      stopsAreSuggested: true,
      proposal: route(),
      baselineProposal: route(),
      flowlineEnhancements: [{ flowline: { id: "f1", name: "Rheintal" }, rationale: "A scenic stretch near your route." }],
      selectedEnhancementIds: ["f1"],
      enhancementMetrics: { distanceDeltaM: 1200, durationDeltaS: 300, elevationGainDeltaM: 80 }
    };
    const html = RoutePlannerPanel(state);
    expect(html).toContain("Optional Flowlines");
    expect(html).toContain("A scenic stretch near your route.");
    expect(html).toContain('data-planner-enhancement="f1"');
    expect(html).toContain("Compared with baseline: +1.2 km · +5m · ↑ +80 m");
  });

  it("shows the aim until a route exists, for A to B routes only without a picked end", () => {
    const state = createPlannerState({ start, sport: "cycling", routeType: "round_trip" });
    expect(showsAim(state)).toBe(true);
    expect(showsAim({ ...state, routeType: "point_to_point" })).toBe(true);
    expect(showsAim({ ...state, routeType: "point_to_point", end: { lat: 47.5, lon: 9.1 } })).toBe(false);
    expect(showsAim({ ...state, generated: true, proposal: route() })).toBe(false);
  });
});
