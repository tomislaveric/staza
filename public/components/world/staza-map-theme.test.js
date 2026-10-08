import { describe, expect, it } from "vitest";
import { STAZA_DARK_PALETTE, applyStazaMapTheme, classifyLayer } from "./staza-map-theme.js";

const providerStyle = () => ({
  version: 8,
  name: "Liberty",
  sprite: "https://tiles.example/sprite",
  glyphs: "https://tiles.example/{fontstack}/{range}.pbf",
  sources: { openmaptiles: { type: "vector", url: "https://tiles.example/planet" } },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#f8f4f0" } },
    { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water", paint: { "fill-color": "rgb(158,189,255)" } },
    { id: "landcover_wood", type: "fill", source: "openmaptiles", "source-layer": "landcover", paint: { "fill-color": "hsla(98,61%,72%,0.7)" } },
    { id: "park_outline", type: "line", source: "openmaptiles", "source-layer": "park", paint: { "line-color": "#6a8f58" } },
    { id: "building", type: "fill", source: "openmaptiles", "source-layer": "building", paint: { "fill-color": "hsl(35,8%,85%)" } },
    { id: "road_minor", type: "line", source: "openmaptiles", "source-layer": "transportation", paint: { "line-color": "#fff", "line-width": 2 } },
    { id: "road_motorway", type: "line", source: "openmaptiles", "source-layer": "transportation", paint: { "line-color": "#fc8" } },
    { id: "road_path_pedestrian", type: "line", source: "openmaptiles", "source-layer": "transportation", paint: { "line-color": "#cba" } },
    { id: "road_minor_casing", type: "line", source: "openmaptiles", "source-layer": "transportation", paint: { "line-color": "#ddd" } },
    { id: "poi_r1", type: "symbol", source: "openmaptiles", "source-layer": "poi", layout: { "icon-size": 1 }, paint: { "text-color": "#666" } },
    { id: "highway-name-minor", type: "symbol", source: "openmaptiles", "source-layer": "transportation_name", paint: { "text-color": "#333" } },
    { id: "label_city", type: "symbol", source: "openmaptiles", "source-layer": "place", layout: { "text-size": 12 }, paint: { "text-color": "#000" } },
    { id: "some_future_layer", type: "fill", source: "openmaptiles", "source-layer": "future", paint: { "fill-color": "#123456" } }
  ]
});

const layerById = (style, id) => style.layers.find((layer) => layer.id === id);

describe("applyStazaMapTheme", () => {
  it("repaints the basemap with the Staza palette", () => {
    const themed = applyStazaMapTheme(providerStyle());

    expect(layerById(themed, "background").paint["background-color"]).toBe(STAZA_DARK_PALETTE.background);
    expect(layerById(themed, "water").paint["fill-color"]).toBe(STAZA_DARK_PALETTE.water);
    expect(layerById(themed, "building").paint["fill-color"]).toBe(STAZA_DARK_PALETTE.building);
    expect(layerById(themed, "park_outline").layout.visibility).toBe("none");
    expect(layerById(themed, "road_motorway").paint["line-color"]).toBe(STAZA_DARK_PALETTE.roadMajor);
    expect(layerById(themed, "road_minor").paint["line-color"]).toBe(STAZA_DARK_PALETTE.roadMinor);
    expect(layerById(themed, "road_minor_casing").paint["line-color"]).toBe(STAZA_DARK_PALETTE.roadCasing);
  });

  it("keeps trails at least as prominent as minor roads for outdoor exploration", () => {
    const themed = applyStazaMapTheme(providerStyle());

    expect(layerById(themed, "road_path_pedestrian").paint["line-color"]).toBe(STAZA_DARK_PALETTE.path);
    expect(STAZA_DARK_PALETTE.path).not.toBe(STAZA_DARK_PALETTE.roadMinor);
  });

  it("hides clutter layers but keeps place labels legible", () => {
    const themed = applyStazaMapTheme(providerStyle());

    expect(layerById(themed, "poi_r1").layout.visibility).toBe("none");
    expect(layerById(themed, "highway-name-minor").layout.visibility).toBe("none");
    expect(layerById(themed, "label_city").layout.visibility).toBeUndefined();
    expect(layerById(themed, "label_city").paint["text-color"]).toBe(STAZA_DARK_PALETTE.labelPrimary);
    expect(layerById(themed, "label_city").paint["text-halo-color"]).toBe(STAZA_DARK_PALETTE.labelHalo);
  });

  it("preserves untouched layout properties of hidden layers", () => {
    const themed = applyStazaMapTheme(providerStyle());

    expect(layerById(themed, "poi_r1").layout["icon-size"]).toBe(1);
  });

  it("passes unknown provider layers through unchanged", () => {
    const themed = applyStazaMapTheme(providerStyle());

    expect(layerById(themed, "some_future_layer").paint["fill-color"]).toBe("#123456");
    expect(classifyLayer(layerById(themed, "some_future_layer"))).toBe("other");
  });

  it("keeps sources, sprite, glyphs, layer count and order intact", () => {
    const original = providerStyle();

    const themed = applyStazaMapTheme(original);

    expect(themed.sources).toEqual(original.sources);
    expect(themed.sprite).toBe(original.sprite);
    expect(themed.glyphs).toBe(original.glyphs);
    expect(themed.layers.map((layer) => layer.id)).toEqual(original.layers.map((layer) => layer.id));
  });

  it("does not mutate the provider style document", () => {
    const original = providerStyle();

    applyStazaMapTheme(original);

    expect(original.layers[0].paint["background-color"]).toBe("#f8f4f0");
    expect(original.layers.find((layer) => layer.id === "poi_r1").layout.visibility).toBeUndefined();
  });

  it("accepts an alternative palette so future map themes need no World changes", () => {
    const themed = applyStazaMapTheme(providerStyle(), { ...STAZA_DARK_PALETTE, background: "#ffffff" });

    expect(layerById(themed, "background").paint["background-color"]).toBe("#ffffff");
  });

  it("rejects a style document without layers", () => {
    expect(() => applyStazaMapTheme(undefined)).toThrow(/layers/);
  });

  it("uses fill-extrusion paint for extruded buildings", () => {
    const style = providerStyle();
    style.layers.push({
      id: "building-3d",
      type: "fill-extrusion",
      source: "openmaptiles",
      "source-layer": "building",
      paint: { "fill-extrusion-color": "hsl(35,8%,85%)" }
    });

    const themed = applyStazaMapTheme(style);

    expect(layerById(themed, "building-3d").paint["fill-extrusion-color"]).toBe(STAZA_DARK_PALETTE.building);
    expect(layerById(themed, "building-3d").paint["fill-color"]).toBeUndefined();
  });
});
