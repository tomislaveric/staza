import { describe, expect, it } from "vitest";
import {
  buildPlanRequest, buildSuggestRequest, collectibleStop, createPlannerState, flowlineStop, moveStop, orderStops, planArea,
  RoutePlannerPanel, ROUTE_INTENTS, toggleStop, waypointStop
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
  it("offers Flow, Chill and Explore with Chill preselected, never speed wording", () => {
    expect(ROUTE_INTENTS.map((intent) => intent.label)).toEqual(["Glide", "Chill", "Explore"]);
    expect(JSON.stringify(ROUTE_INTENTS)).not.toMatch(/fast|speed|quick/i);
    const state = createPlannerState({ start: { lat: 47, lon: 9 } });
    expect(state.intent).toBe("chill");
    expect(RoutePlannerPanel(state)).toMatch(/data-planner-intent="chill" aria-pressed="true"/);
  });

  it("sends the chosen intent with Generate route", () => {
    const area = { bbox: "9,47,9.2,47.2", center: { lat: 47.1, lon: 9.1 }, zoom: 11 };
    expect(buildSuggestRequest(createPlannerState({ start: { lat: 47, lon: 9 }, intent: "flow" }), area).body)
      .toEqual({ area, sport: "cycling", start: { lat: 47, lon: 9 }, routeType: "round_trip", intent: "flow" });
    expect(buildSuggestRequest(createPlannerState(), area).error).toBe("Choose a start on the map.");
  });
});
