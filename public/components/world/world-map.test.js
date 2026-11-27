import { describe, expect, it } from "vitest";
import {
  clickHitsFeature,
  ROUTE_SOURCE_ID,
  SAVED_ROUTES_SOURCE_ID,
  createHomeMarkerElement,
  homeScaleZoom,
  routeLayers,
  routeToGeoJson,
  savedRouteLayers,
  savedRoutesToGeoJson,
  worldMapInitialView
} from "./world-map.js";

describe("quest route layers", () => {
  it("draws glow, casing and line in that order from one source", () => {
    const layers = routeLayers();

    expect(layers.map((layer) => layer.id)).toEqual([
      `${ROUTE_SOURCE_ID}-glow`,
      `${ROUTE_SOURCE_ID}-casing`,
      `${ROUTE_SOURCE_ID}-line`
    ]);
    expect(layers.every((layer) => layer.source === ROUTE_SOURCE_ID)).toBe(true);
  });

  it("uses rounded joins and zoom-interpolated width", () => {
    for (const layer of routeLayers()) {
      expect(layer.layout["line-cap"]).toBe("round");
      expect(layer.layout["line-join"]).toBe("round");
      expect(layer.paint["line-width"].slice(0, 3)).toEqual(["interpolate", ["linear"], ["zoom"]]);
    }
  });

  it("keeps the Staza accent on the visible route line", () => {
    const line = routeLayers().find((layer) => layer.id.endsWith("-line"));

    expect(line.paint["line-color"]).toBe("#e8b80a");
  });
});

describe("routeToGeoJson", () => {
  it("never fabricates geometry for quests without a route", () => {
    expect(routeToGeoJson(undefined).geometry).toEqual({ type: "LineString", coordinates: [] });
  });
});

describe("saved World map home", () => {
  it("keeps the existing default view when no home location exists", () => {
    expect(worldMapInitialView()).toEqual({
      center: { longitude: 8.4037, latitude: 49.0069 },
      zoom: 12
    });
  });

  it("centers on the saved home and chooses a zoom for a 5 km scale bar", () => {
    const home = { latitude: 49, longitude: 8.4 };
    const view = worldMapInitialView(home);
    const scaleDistanceMeters = Math.cos(home.latitude * Math.PI / 180)
      * 2 * Math.PI * 6_371_008.8 * 110
      / (512 * 2 ** view.zoom);

    expect(view.center).toEqual({ longitude: home.longitude, latitude: home.latitude });
    expect(scaleDistanceMeters).toBeGreaterThanOrEqual(5_000);
    expect(scaleDistanceMeters).toBeLessThan(10_000);
    expect(Number.isFinite(homeScaleZoom(90))).toBe(true);
  });

  it("builds an accessible marker using the existing home icon", () => {
    const createElement = (tag) => ({
      tag,
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      append(child) { this.child = child; }
    });
    const marker = createHomeMarkerElement({ createElement });

    expect(marker.className).toBe("world-home-marker");
    expect(marker.attributes).toEqual({ role: "img", "aria-label": "Saved home location" });
    expect(marker.child.src).toBe("/assets/nav-home.svg");
    expect(marker.child.attributes["aria-hidden"]).toBe("true");
  });
});

describe("saved Exploration routes", () => {
  it("draws every saved route as one dotted, low-prominence line without status styling", () => {
    const [layer] = savedRouteLayers();
    expect(savedRouteLayers()).toHaveLength(1);
    expect(layer.source).toBe(SAVED_ROUTES_SOURCE_ID);
    expect(layer.paint["line-dasharray"]).toBeDefined();
    expect(layer.paint["line-opacity"]).toBeLessThan(0.6);
    expect(JSON.stringify(layer.paint)).not.toContain("status");
  });

  it("maps routes with geometry to features", () => {
    const geometry = { type: "LineString", coordinates: [[9, 47], [9.1, 47.1]] };
    expect(savedRoutesToGeoJson([
      { id: "a", status: "active", geometry },
      { id: "b", status: "completed", geometry: { type: "LineString", coordinates: [] } }
    ]).features).toEqual([{ type: "Feature", properties: { explorationId: "a" }, geometry }]);
  });
});

describe("map clicks", () => {
  const fakeMap = (layers, hits) => ({
    getLayer: (id) => (layers.includes(id) ? { id } : undefined),
    queryRenderedFeatures: (_point, options) => hits.filter((hit) => options.layers.includes(hit.layer))
  });

  it("treats a click on a POI or Flowline as a selection, not a map point", () => {
    expect(clickHitsFeature(fakeMap(["staza-collectibles"], [{ layer: "staza-collectibles" }]), { x: 1, y: 1 })).toBe(true);
    expect(clickHitsFeature(fakeMap(["staza-fartleks-hit"], [{ layer: "staza-fartleks-hit" }]), { x: 1, y: 1 })).toBe(true);
  });

  it("reports empty map clicks and maps without selectable layers", () => {
    expect(clickHitsFeature(fakeMap(["staza-collectibles"], []), { x: 1, y: 1 })).toBe(false);
    expect(clickHitsFeature(fakeMap([], [{ layer: "staza-collectibles" }]), { x: 1, y: 1 })).toBe(false);
  });
});
