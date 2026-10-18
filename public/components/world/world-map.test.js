import { describe, expect, it, vi } from "vitest";
import {
  ALTERNATES_SOURCE_ID,
  ROUTE_SOURCE_ID,
  alternateRouteLayers,
  alternateRoutesToGeoJson,
  createHomeMarkerElement,
  homeScaleZoom,
  loadStazaStyle,
  routeLayers,
  routeToGeoJson,
  worldMapInitialView
} from "./world-map.js";
import { STAZA_DARK_PALETTE } from "./staza-map-theme.js";

const providerStyle = () => ({
  version: 8,
  sources: { openmaptiles: { type: "vector", url: "https://tiles.example/planet" } },
  layers: [{ id: "background", type: "background", paint: { "background-color": "#f8f4f0" } }]
});

describe("loadStazaStyle", () => {
  it("themes the fetched provider style", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => providerStyle() });

    const style = await loadStazaStyle("https://tiles.example/styles/liberty", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith("https://tiles.example/styles/liberty");
    expect(style.layers[0].paint["background-color"]).toBe(STAZA_DARK_PALETTE.background);
  });

  it("falls back to the provider url when the style cannot be fetched", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("offline"));

    await expect(loadStazaStyle("https://tiles.example/styles/liberty", failing))
      .resolves.toBe("https://tiles.example/styles/liberty");
  });

  it("falls back to the provider url on a non-ok response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });

    await expect(loadStazaStyle("https://tiles.example/styles/liberty", fetchImpl))
      .resolves.toBe("https://tiles.example/styles/liberty");
  });
});

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

describe("alternate exploration routes", () => {
  it("draws unselected proposals muted, without the quest accent glow", () => {
    const layers = alternateRouteLayers();
    expect(layers.every((layer) => layer.source === ALTERNATES_SOURCE_ID)).toBe(true);
    expect(layers.some((layer) => layer.id.endsWith("-glow"))).toBe(false);
    const line = layers.find((layer) => layer.id.endsWith("-line"));
    expect(line.paint["line-color"]).not.toBe("#e8b80a");
    expect(line.paint["line-opacity"]).toBeLessThan(0.95);
  });

  it("tags each route with its proposal id and skips empty geometry", () => {
    const geometry = { type: "LineString", coordinates: [[9, 50], [9.1, 50.1]] };
    expect(alternateRoutesToGeoJson([{ id: "a", geometry }, { id: "b" }])).toEqual({
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: { proposalId: "a" }, geometry }]
    });
    expect(alternateRoutesToGeoJson().features).toEqual([]);
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
