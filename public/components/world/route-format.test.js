import { describe, expect, it } from "vitest";
import { formatRouteDistance, formatRouteDuration, plannedRouteGpxUrl, plannedRouteSummary } from "./route-format.js";
import { endpointsToGeoJson } from "./world-map.js";

describe("route formatting", () => {
  it("formats distance, duration and planned-route summaries", () => {
    expect(formatRouteDistance(42_300)).toBe("42.3 km");
    expect(formatRouteDistance(123_456)).toBe("123 km");
    expect(formatRouteDuration(5_400)).toBe("1h 30m");
    expect(formatRouteDuration(600)).toBe("10m");
    expect(plannedRouteSummary({ distanceM: 42_300, durationS: 5_400, routeType: "point_to_point" }))
      .toBe("42.3 km · 1h 30m · A to B");
  });

  it("links the GPX download for a planned route", () => {
    expect(plannedRouteGpxUrl("0b8f1c1e")).toBe("/api/quest-instances/0b8f1c1e/planned-route.gpx");
  });
});

describe("endpointsToGeoJson", () => {
  it("emits start and distinct destination markers", () => {
    expect(endpointsToGeoJson().features).toEqual([]);
    expect(endpointsToGeoJson({ start: { lat: 50, lon: 9 }, end: { lat: 50, lon: 9 } }).features).toHaveLength(1);
    expect(endpointsToGeoJson({ start: { lat: 50, lon: 9 }, end: { lat: 51, lon: 10 } }).features)
      .toEqual([
        { type: "Feature", properties: { kind: "start" }, geometry: { type: "Point", coordinates: [9, 50] } },
        { type: "Feature", properties: { kind: "end" }, geometry: { type: "Point", coordinates: [10, 51] } }
      ]);
  });
});
