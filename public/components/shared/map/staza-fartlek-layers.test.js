import { describe, expect, it } from "vitest";
import {
  bindFartlekInteractions,
  ensureFartlekLayers,
  FARTLEK_HIT_LAYER,
  FARTLEK_SOURCE,
  fartlekFeature,
  fartlekLayers,
  fartleksToFeatureCollection,
  setFartlekData
} from "./staza-fartlek-layers.js";

const fartlek = (overrides = {}) => ({
  id: "fartlek-1",
  name: "Harbour Straight",
  geometry: { type: "LineString", coordinates: [[8, 49], [8.1, 49.1]] },
  completed: false,
  ...overrides
});

describe("fartlekLayers", () => {
  it("draws selection emphasis and casing under the line, with the hit-area last", () => {
    const layers = fartlekLayers();
    expect(layers.map((layer) => layer.id)).toEqual([
      "staza-fartleks-selected",
      "staza-fartleks-casing",
      "staza-fartleks-line",
      "staza-fartleks-hit"
    ]);
    expect(layers.every((layer) => layer.type === "line")).toBe(true);
    expect(layers.every((layer) => layer.source === FARTLEK_SOURCE)).toBe(true);
  });

  it("renders the hit-area fully transparent and wide, so clicking never requires pixel precision", () => {
    const hitLayer = fartlekLayers().find((layer) => layer.id === FARTLEK_HIT_LAYER);
    expect(hitLayer.paint["line-opacity"]).toBe(0);
    expect(hitLayer.paint["line-width"]).toBe(16);
  });

  it("shows completed segments in Staza gold and keeps uncompleted segments subdued", () => {
    const lineLayer = fartlekLayers().find((layer) => layer.id === "staza-fartleks-line");
    const completed = ["==", ["get", "completed"], true];

    expect(lineLayer.paint["line-color"]).toEqual(["case", completed, "#e8b80a", "#6b9eac"]);
    expect(lineLayer.paint["line-opacity"]).toEqual(["case", completed, 0.95, 0.82]);
  });
});

describe("fartlekFeature / fartleksToFeatureCollection", () => {
  it("carries the LineString geometry unchanged and encodes completion/selection as properties", () => {
    const feature = fartlekFeature(fartlek({ completed: true }), "fartlek-1");
    expect(feature.geometry.type).toBe("LineString");
    expect(feature.properties).toMatchObject({ id: "fartlek-1", completed: true, selected: true });
  });

  it("never carries point-collectible fields such as radius", () => {
    const feature = fartlekFeature(fartlek());
    expect(feature.properties).not.toHaveProperty("radiusMeters");
    expect(feature.properties.selected).toBe(false);
  });

  it("builds a FeatureCollection with one feature per Fartlek", () => {
    const collection = fartleksToFeatureCollection([fartlek(), fartlek({ id: "fartlek-2" })]);
    expect(collection.type).toBe("FeatureCollection");
    expect(collection.features).toHaveLength(2);
  });
});

/** A minimal fake MapLibre map sufficient to exercise source/layer wiring and click binding. */
const fakeMap = () => {
  const sources = new Map();
  const handlers = new Map();
  return {
    getSource: (id) => sources.get(id),
    addSource: (id, source) => sources.set(id, { ...source, setData: (data) => { source.data = data; } }),
    addLayer: () => {},
    on: (type, layerId, handler) => handlers.set(`${type}:${layerId}`, handler),
    getCanvas: () => ({ style: {} }),
    _handlers: handlers,
    _sources: sources
  };
};

describe("ensureFartlekLayers / setFartlekData", () => {
  it("adds the source once and is a no-op on a second call", () => {
    const map = fakeMap();
    ensureFartlekLayers(map);
    ensureFartlekLayers(map);
    expect(map._sources.size).toBe(1);
  });

  it("updates the source data and reports when no source exists yet", () => {
    const map = fakeMap();
    expect(setFartlekData(map, fartleksToFeatureCollection([fartlek()]))).toBe(false);
    ensureFartlekLayers(map);
    expect(setFartlekData(map, fartleksToFeatureCollection([fartlek()]))).toBe(true);
  });
});

describe("bindFartlekInteractions", () => {
  it("invokes onSelect with the clicked Fartlek's id from the wide hit-area layer", () => {
    const map = fakeMap();
    const selected = [];
    bindFartlekInteractions(map, { onSelect: (id) => selected.push(id) });
    map._handlers.get(`click:${FARTLEK_HIT_LAYER}`)({ features: [{ properties: { id: "fartlek-9" } }] });
    expect(selected).toEqual(["fartlek-9"]);
  });
});
