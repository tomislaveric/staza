import { describe, expect, it } from "vitest";
import {
  areaMoved, buildPlanRequest, buildSuggestRequest, canGenerate, collectibleStop, createPlannerState, flowlineStop, moveStop,
  orderAlternatives, orderStops, planArea, RoutePlannerPanel, ROUTE_INTENTS, suggestedStops, toggleStop, waypointStop
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

describe("route intents", () => {
  it("offers Glide, Chill and Explore, never speed wording", () => {
    expect(ROUTE_INTENTS.map((intent) => intent.label)).toEqual(["Glide", "Chill", "Explore"]);
    expect(JSON.stringify(ROUTE_INTENTS)).not.toMatch(/fast|speed|quick/i);
  });
});

describe("planner wizard", () => {
  const start = { lat: 47, lon: 9 };
  const area = { bbox: "9,47,9.2,47.2", center: { lat: 47.1, lon: 9.1 }, zoom: 11 };
  const route = (intent, extra = {}) => ({ id: `p-${intent}`, intent, distanceM: 12000, durationS: 2400, geometry: { coordinates: [] }, ...extra });

  it("asks for sport and shape first, then generates once a start is known", () => {
    const state = createPlannerState({ start });
    expect(canGenerate(state)).toBe(false);
    const html = RoutePlannerPanel(state);
    expect(html).toContain('data-planner-sport="cycling" aria-pressed="false"');
    expect(html).toContain('data-planner-shape="round_trip"');
    expect(html).not.toContain("data-planner-add");
    expect(html).not.toContain("data-planner-intent");
    const ready = { ...state, sportChosen: true, shapeChosen: true, stepsOpen: false };
    expect(canGenerate(ready)).toBe(true);
    expect(canGenerate({ ...ready, routeType: "point_to_point" })).toBe(false);
    expect(RoutePlannerPanel(ready)).toContain("data-planner-steps");
    expect(RoutePlannerPanel(ready)).not.toContain("data-planner-sport");
  });

  it("requests all three feels in one call and grows the area to contain an A to B end", () => {
    const state = createPlannerState({ start, sport: "running", routeType: "round_trip" });
    expect(buildSuggestRequest(state, area).body)
      .toEqual({ area, sport: "running", start, routeType: "round_trip", intents: ["flow", "chill", "explore"] });
    const end = { lat: 47.5, lon: 9.1 };
    const { body } = buildSuggestRequest({ ...state, routeType: "point_to_point", end }, area);
    expect(body).toMatchObject({ routeType: "point_to_point", end });
    const [, south, , north] = body.area.bbox.split(",").map(Number);
    expect(south).toBe(47);
    expect(north).toBeGreaterThan(47.5);
    expect(buildSuggestRequest(createPlannerState(), area).error).toBe("Choose a start on the map.");
  });

  it("lists the routes, then shows the chosen card above its stops and the others collapsed", () => {
    const alternatives = orderAlternatives([route("explore"), route("flow"), route("chill")]);
    expect(alternatives.map((item) => item.intent)).toEqual(["flow", "chill", "explore"]);
    const state = { ...createPlannerState({ start, sport: "cycling", routeType: "round_trip" }), alternatives };
    const listed = RoutePlannerPanel(state);
    expect(listed.match(/data-planner-choose=/g)).toHaveLength(3);
    expect(listed).not.toContain("data-planner-save");

    const chosen = RoutePlannerPanel({ ...state, chosenIntent: "chill", proposal: alternatives[1], stops: [peak], stopsAreSuggested: true });
    expect(chosen.match(/data-planner-choose=/g)).toHaveLength(2);
    expect(chosen).not.toContain('data-planner-choose="chill"');
    expect(chosen).toContain("Other routes");
    expect(chosen.indexOf("data-planner-save")).toBeLessThan(chosen.indexOf('data-planner-stop="peak-1"'));
    expect(chosen).toContain("data-planner-add");
  });

  it("turns a route's collectibles and unridden Flowlines into stops", () => {
    const catalog = {
      collectibles: [{ id: "peak-1", name: "Peak", type: "peak", latitude: 47.5, longitude: 9.5 }],
      flowlines: [{ id: "f1", name: "Rheintal", geometry: { coordinates: [[9, 47]] } }, { id: "done", completed: true }]
    };
    const stops = suggestedStops(route("chill", { includedTargetIds: ["peak-1"], traversedFlowlines: [{ id: "f1" }, { id: "f1" }, { id: "done" }] }), catalog);
    expect(stops.map((stop) => stop.id)).toEqual(["peak-1", "f1"]);
  });

  it("flags a clearly moved map but not zooming in", () => {
    const bbox = "9,47,10,48";
    expect(areaMoved(bbox, { west: 9.2, south: 47.2, east: 9.8, north: 47.8 })).toBe(false);
    expect(areaMoved(bbox, { west: 10.2, south: 47, east: 11.2, north: 48 })).toBe(true);
    expect(areaMoved(bbox, { west: 8, south: 46.5, east: 11, north: 48.5 })).toBe(true);
  });
});
