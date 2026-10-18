import { describe, expect, it } from "vitest";
import {
  boundsToParameter,
  expandBounds,
  isServedByLoadedArea,
  LAYER_ORDER,
  lineFeature,
  pointFeature,
  pointsToBounds,
  routeToGeoJson
} from "./staza-map-utils.js";

describe("pointsToBounds", () => {
  it("returns a [[west, south], [east, north]] box that frames every point", () => {
    const bounds = pointsToBounds([
      { longitude: 8.4, latitude: 49.0 },
      { longitude: 8.6, latitude: 49.2 },
      { longitude: 8.3, latitude: 48.9 }
    ]);

    expect(bounds).toEqual([[8.3, 48.9], [8.6, 49.2]]);
  });

  it("ignores non-finite points and returns undefined when nothing is framable", () => {
    expect(pointsToBounds([])).toBeUndefined();
    expect(pointsToBounds([{ longitude: NaN, latitude: 1 }, { latitude: 2 }])).toBeUndefined();
    expect(pointsToBounds([{ longitude: 5, latitude: 5 }, { longitude: NaN, latitude: 9 }]))
      .toEqual([[5, 5], [5, 5]]);
  });
});

describe("geometry helpers", () => {
  it("builds a LineString feature from coordinates and never fabricates quest geometry", () => {
    expect(lineFeature([[1, 2], [3, 4]]).geometry).toEqual({ type: "LineString", coordinates: [[1, 2], [3, 4]] });
    expect(routeToGeoJson(undefined).geometry).toEqual({ type: "LineString", coordinates: [] });
  });

  it("builds a Point feature and stays collection-safe when the coordinate is absent", () => {
    expect(pointFeature([8, 49], { kind: "rider" })).toEqual({
      type: "Feature",
      properties: { kind: "rider" },
      geometry: { type: "Point", coordinates: [8, 49] }
    });
    expect(pointFeature().geometry).toEqual({ type: "Point", coordinates: [] });
  });
});

describe("bounds parameter", () => {
  it("serialises bounds to a fixed-precision bbox string", () => {
    expect(boundsToParameter({ west: 8.1, south: 49.1, east: 8.2, north: 49.2 }))
      .toBe("8.10000,49.10000,8.20000,49.20000");
  });
});

describe("LAYER_ORDER", () => {
  it("declares the canonical bottom-to-top draw order", () => {
    expect(LAYER_ORDER).toEqual([
      "route-background",
      "route-progress",
      "collectibles",
      "selection",
      "position"
    ]);
  });
});

describe("area cache helpers", () => {
  const km = (bounds) => ({
    height: (bounds.north - bounds.south) * 111.32,
    width: (bounds.east - bounds.west) * 111.32 * Math.cos(((bounds.north + bounds.south) / 2) * Math.PI / 180)
  });

  it("expands small bounds to at least 200 km around the same center and never shrinks large ones", () => {
    const small = { west: 8.3, south: 48.9, east: 8.5, north: 49.0 };
    const expanded = expandBounds(small);
    expect(km(expanded).width).toBeGreaterThanOrEqual(199);
    expect(km(expanded).height).toBeGreaterThanOrEqual(199);
    expect((expanded.west + expanded.east) / 2).toBeCloseTo(8.4);
    const large = { west: 0, south: 40, east: 10, north: 50 };
    expect(expandBounds(large)).toEqual(large);
  });

  it("serves viewports inside the loaded area, only from its center when truncated", () => {
    const area = { west: 0, south: 0, east: 10, north: 10 };
    const nearEdge = { west: 0.5, south: 4, east: 1.5, north: 5 };
    const centered = { west: 4, south: 4, east: 6, north: 6 };
    expect(isServedByLoadedArea(undefined, centered)).toBe(false);
    expect(isServedByLoadedArea({ bounds: area, truncated: false }, nearEdge)).toBe(true);
    expect(isServedByLoadedArea({ bounds: area, truncated: true }, nearEdge)).toBe(false);
    expect(isServedByLoadedArea({ bounds: area, truncated: true }, centered)).toBe(true);
    expect(isServedByLoadedArea({ bounds: area, truncated: false }, { ...centered, east: 11 })).toBe(false);
  });

  it("reloads a truncated cache when zooming in beyond its source viewport", () => {
    const loaded = {
      bounds: { west: 0, south: 0, east: 10, north: 10 },
      sourceViewport: { west: 4, south: 4, east: 6, north: 6 },
      truncated: true
    };

    expect(isServedByLoadedArea(loaded, { west: 4, south: 4, east: 6, north: 6 })).toBe(true);
    expect(isServedByLoadedArea(loaded, { west: 4.5, south: 4.5, east: 5.5, north: 5.5 })).toBe(false);
  });
});
