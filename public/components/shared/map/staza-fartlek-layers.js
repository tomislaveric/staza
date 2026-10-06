import { EMPTY_FEATURE_COLLECTION } from "./staza-collectible-features.js";

/**
 * Fartlek MapLibre vocabulary: a linear road/path segment challenge, rendered as a `line`
 * layer (never a point marker), following the shared Staza map foundation's conventions
 * (`staza-map.js`, `staza-collectible-layers.js`, `staza-route-layers.js`). One GeoJSON
 * source with `LineString` features; property-driven paint expressions carry
 * available/completed/selected state, consistent with the collectible layer's
 * `match`/`case` pattern.
 */

export const FARTLEK_SOURCE = "staza-fartleks";
export const FARTLEK_CASING_LAYER = "staza-fartleks-casing";
export const FARTLEK_LINE_LAYER = "staza-fartleks-line";
export const FARTLEK_SELECTED_LAYER = "staza-fartleks-selected";
export const FARTLEK_HIT_LAYER = "staza-fartleks-hit";

const CASING_COLOR = "#0b0c0f";
const UNCOMPLETED_LINE = "#7c828c";
const COMPLETED_LINE = "#e8b80a";
const SELECTED_ACCENT = "#e8b80a";

const SELECTED = ["==", ["get", "selected"], true];
const COMPLETED = ["==", ["get", "completed"], true];

const lineWidth = (stops) => ["interpolate", ["linear"], ["zoom"], ...stops.flatMap(([zoom, value]) => [zoom, value])];

const CASING_WIDTH_STOPS = [[9, 2.4], [12, 3.4], [15, 4.6], [17, 5.6]];
const LINE_WIDTH_STOPS = [[9, 1.2], [12, 1.8], [15, 2.6], [17, 3.4]];
const SELECTED_WIDTH_STOPS = [[9, 5], [12, 7], [15, 9], [17, 11]];

const fartlekCasingLayer = () => ({
  id: FARTLEK_CASING_LAYER,
  type: "line",
  source: FARTLEK_SOURCE,
  layout: { "line-cap": "round", "line-join": "round" },
  paint: {
    "line-color": CASING_COLOR,
    "line-opacity": 0.6,
    "line-width": lineWidth(CASING_WIDTH_STOPS)
  }
});

/** The segment itself: neutral while uncompleted, the same Staza gold used for visited state once completed. */
const fartlekLineLayer = () => ({
  id: FARTLEK_LINE_LAYER,
  type: "line",
  source: FARTLEK_SOURCE,
  layout: { "line-cap": "round", "line-join": "round" },
  paint: {
    "line-color": ["case", COMPLETED, COMPLETED_LINE, UNCOMPLETED_LINE],
    "line-opacity": 0.95,
    "line-width": lineWidth(LINE_WIDTH_STOPS)
  }
});

/** A soft selection emphasis under the line, mirroring the collectible selected-glow treatment. */
const fartlekSelectedLayer = () => ({
  id: FARTLEK_SELECTED_LAYER,
  type: "line",
  source: FARTLEK_SOURCE,
  filter: SELECTED,
  layout: { "line-cap": "round", "line-join": "round" },
  paint: {
    "line-color": SELECTED_ACCENT,
    "line-opacity": 0.22,
    "line-width": lineWidth(SELECTED_WIDTH_STOPS)
  }
});

/**
 * A wide, fully transparent hit-area so a narrow road line is easy to click without a
 * pixel-perfect requirement (~16px per the spec, constant across zoom).
 */
const fartlekHitLayer = () => ({
  id: FARTLEK_HIT_LAYER,
  type: "line",
  source: FARTLEK_SOURCE,
  layout: { "line-cap": "round", "line-join": "round" },
  paint: {
    "line-color": "#000000",
    "line-opacity": 0,
    "line-width": 16
  }
});

/** Draw order: selection emphasis, casing, line, then the invisible hit-area on top for clicks. */
export const fartlekLayers = () => [
  fartlekSelectedLayer(),
  fartlekCasingLayer(),
  fartlekLineLayer(),
  fartlekHitLayer()
];

/**
 * Adds the Fartlek source and layers once. Per the rendering order in the spec, Fartlek
 * segment layers draw above routes/activity layers but under point collectibles, so callers
 * must add this before the collectible layers.
 */
export const ensureFartlekLayers = (map) => {
  if (map.getSource(FARTLEK_SOURCE)) return;
  map.addSource(FARTLEK_SOURCE, {
    type: "geojson",
    promoteId: "id",
    data: EMPTY_FEATURE_COLLECTION
  });
  for (const layer of fartlekLayers()) map.addLayer(layer);
};

export const setFartlekData = (map, featureCollection) => {
  const source = map.getSource(FARTLEK_SOURCE);
  if (!source) return false;
  source.setData(featureCollection ?? EMPTY_FEATURE_COLLECTION);
  return true;
};

/** Converts a World Fartlek into a canonical GeoJSON LineString feature. */
export const fartlekFeature = (fartlek, selectedId) => ({
  type: "Feature",
  id: fartlek.id,
  geometry: fartlek.geometry,
  properties: {
    id: fartlek.id,
    name: fartlek.name,
    completed: Boolean(fartlek.completed),
    selected: fartlek.id === selectedId
  }
});

export const fartleksToFeatureCollection = (fartleks, { selectedId } = {}) => ({
  type: "FeatureCollection",
  features: fartleks.map((fartlek) => fartlekFeature(fartlek, selectedId))
});

const featureFartlekId = (event) => event?.features?.[0]?.properties?.id;

/** Routes native hit-layer events into the caller's selection flow, via the wide click target. */
export const bindFartlekInteractions = (map, { onSelect }) => {
  map.on("click", FARTLEK_HIT_LAYER, (event) => {
    const id = featureFartlekId(event);
    if (id === undefined) return;
    if (event.originalEvent?.stopPropagation) event.originalEvent.stopPropagation();
    onSelect(id);
  });
  map.on("mouseenter", FARTLEK_HIT_LAYER, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", FARTLEK_HIT_LAYER, () => {
    map.getCanvas().style.cursor = "";
  });
};
