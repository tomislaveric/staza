import { describe, expect, it, vi } from "vitest";
import {
  bindCollectibleInteractions,
  COLLECTIBLE_ACTIVITY_COLLECTED_LAYER,
  COLLECTIBLE_LAYER,
  COLLECTIBLE_SELECTED_GLOW_LAYER,
  COLLECTIBLE_SELECTED_LAYER,
  COLLECTIBLE_SOURCE,
  ensureCollectibleLayers,
  setCollectibleData
} from "./collectible-layers.js";

const fakeMap = () => {
  const sources = new Map();
  const layers = [];
  const handlers = new Map();
  const canvas = { style: {} };
  return {
    sources,
    layers,
    canvas,
    addSource(id, source) {
      sources.set(id, { ...source, setData: vi.fn() });
    },
    getSource: (id) => sources.get(id),
    addLayer(layer) {
      layers.push(layer);
    },
    getLayer: (id) => layers.find((layer) => layer.id === id),
    on(type, layerId, handler) {
      handlers.set(`${type}:${layerId}`, handler);
    },
    emit(type, layerId, event) {
      handlers.get(`${type}:${layerId}`)?.(event);
    },
    getCanvas: () => canvas
  };
};

describe("collectible source and layers", () => {
  it("adds one canonical source with the collectible and selection layers in order", () => {
    const map = fakeMap();

    ensureCollectibleLayers(map);

    expect(map.getSource(COLLECTIBLE_SOURCE).type).toBe("geojson");
    expect(map.getSource(COLLECTIBLE_SOURCE).promoteId).toBe("id");
    expect(map.layers.map((layer) => layer.id)).toEqual([
      COLLECTIBLE_LAYER,
      COLLECTIBLE_ACTIVITY_COLLECTED_LAYER,
      COLLECTIBLE_SELECTED_GLOW_LAYER,
      COLLECTIBLE_SELECTED_LAYER
    ]);
  });

  it("draws the selection emphasis from the same source instead of a separate dataset", () => {
    const map = fakeMap();

    ensureCollectibleLayers(map);

    for (const id of [COLLECTIBLE_SELECTED_GLOW_LAYER, COLLECTIBLE_SELECTED_LAYER]) {
      const selected = map.getLayer(id);
      expect(selected.source).toBe(COLLECTIBLE_SOURCE);
      expect(selected.filter).toEqual(["==", ["get", "selected"], true]);
    }
  });

  it("encodes discovery and category in the fill and rarity in the ring", () => {
    const map = fakeMap();

    ensureCollectibleLayers(map);

    const { paint } = map.getLayer(COLLECTIBLE_LAYER);
    expect(paint["circle-color"]).toEqual([
      "case",
      ["any", ["get", "visited"], ["==", ["get", "activityCollected"], true]],
      "#e8b80a",
      ["match", ["get", "category"],
        "viewpoint", "#43a6c6",
        "peak", "#6d9f55",
        "castle", "#c47a44",
        "waterfall", "#397fc4",
        "place", "#b06ea8",
        "#171a20"]
    ]);
    const stroke = JSON.stringify(paint["circle-stroke-color"]);
    expect(stroke).toContain("#4d9de0");
    expect(stroke).toContain("#9b6ddf");
  });

  it("scales markers with zoom instead of a fixed pixel radius", () => {
    const map = fakeMap();

    ensureCollectibleLayers(map);

    const { paint } = map.getLayer(COLLECTIBLE_LAYER);
    expect(paint["circle-radius"].slice(0, 3)).toEqual(["interpolate", ["linear"], ["zoom"]]);
    expect(paint["circle-stroke-width"].slice(0, 3)).toEqual(["interpolate", ["linear"], ["zoom"]]);
    expect(map.getLayer(COLLECTIBLE_SELECTED_LAYER).paint["circle-radius"].slice(0, 3))
      .toEqual(["interpolate", ["linear"], ["zoom"]]);
  });

  it("raises the selected marker without moving it", () => {
    const map = fakeMap();

    ensureCollectibleLayers(map);

    const radius = JSON.stringify(map.getLayer(COLLECTIBLE_LAYER).paint["circle-radius"]);
    expect(radius).toContain("selected");
    expect(radius).toContain("case");
  });

  it("dims collectibles outside the active quest while keeping them rendered", () => {
    const map = fakeMap();

    ensureCollectibleLayers(map);

    const { paint } = map.getLayer(COLLECTIBLE_LAYER);
    expect(JSON.stringify(paint["circle-opacity"])).toContain("questRelated");
    expect(JSON.stringify(paint["circle-stroke-opacity"])).toContain("questRelated");
  });

  it("is idempotent so repeated renders never rebuild the layer stack", () => {
    const map = fakeMap();

    ensureCollectibleLayers(map);
    ensureCollectibleLayers(map);

    expect(map.layers).toHaveLength(4);
  });

  it("updates viewport data through setData on the existing source", () => {
    const map = fakeMap();
    ensureCollectibleLayers(map);
    const featureCollection = { type: "FeatureCollection", features: [] };

    expect(setCollectibleData(map, featureCollection)).toBe(true);

    expect(map.getSource(COLLECTIBLE_SOURCE).setData).toHaveBeenCalledWith(featureCollection);
    expect(map.layers).toHaveLength(4);
  });

  it("ignores data updates before the source exists", () => {
    expect(setCollectibleData(fakeMap(), { type: "FeatureCollection", features: [] })).toBe(false);
  });
});

describe("collectible layer interactions", () => {
  it("selects the clicked collectible exactly once", () => {
    const map = fakeMap();
    const onSelect = vi.fn();
    bindCollectibleInteractions(map, { onSelect });

    map.emit("click", COLLECTIBLE_LAYER, { features: [{ properties: { id: "castle-7" } }] });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("castle-7");
  });

  it("ignores clicks without a collectible feature", () => {
    const map = fakeMap();
    const onSelect = vi.fn();
    bindCollectibleInteractions(map, { onSelect });

    map.emit("click", COLLECTIBLE_LAYER, { features: [] });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows and clears the pointer cursor on hover", () => {
    const map = fakeMap();
    bindCollectibleInteractions(map, { onSelect: vi.fn() });

    map.emit("mouseenter", COLLECTIBLE_LAYER, {});
    expect(map.canvas.style.cursor).toBe("pointer");

    map.emit("mouseleave", COLLECTIBLE_LAYER, {});
    expect(map.canvas.style.cursor).toBe("");
  });
});
