import { EMPTY_FEATURE_COLLECTION } from "./staza-collectible-features.js";

export const COLLECTIBLE_SOURCE = "staza-collectibles";
export const COLLECTIBLE_LAYER = "staza-collectibles";
export const COLLECTIBLE_ACTIVITY_COLLECTED_LAYER = "staza-collectibles-activity-collected";
export const COLLECTIBLE_SELECTED_GLOW_LAYER = "staza-collectibles-selected-glow";
export const COLLECTIBLE_SELECTED_LAYER = "staza-collectibles-selected";

const VISITED_FILL = "#e8b80a";
const UNVISITED_FILL = "#171a20";
const NEUTRAL_RING = "#7c828c";
const SELECTED_ACCENT = "#e8b80a";
const CATEGORY_FILL = ["match", ["get", "category"],
  "viewpoint", "#43a6c6",
  "peak", "#6d9f55",
  "castle", "#c47a44",
  "waterfall", "#397fc4",
  "place", "#b06ea8",
  UNVISITED_FILL];

/** Rarity is carried by the ring so the map never becomes a field of bright tokens. */
const RARITY_RING = ["match", ["get", "rarity"],
  "rare", "#4d9de0",
  "epic", "#9b6ddf",
  NEUTRAL_RING];

const SELECTED = ["==", ["get", "selected"], true];
const IS_RARE = ["!=", ["get", "rarity"], "common"];
const ACTIVITY_COLLECTED = ["==", ["get", "activityCollected"], true];
/** Visited state stays gold; unvisited imported landmarks use their semantic category color. */
const FILLED = ["any", ["get", "visited"], ACTIVITY_COLLECTED];

/** Far out stays readable but uncluttered; close in stays crisp. */
const zoomSize = (stops, condition, scale) => [
  "interpolate", ["linear"], ["zoom"],
  ...stops.flatMap(([zoom, value]) => [
    zoom,
    condition ? ["case", condition, value * scale, value] : value
  ])
];

const RADIUS_STOPS = [[9, 4], [12, 7], [15, 10], [17, 12]];
const STROKE_STOPS = [[9, 1], [12, 1.4], [15, 1.8], [17, 2]];
const SELECTED_RING_STOPS = [[9, 8], [12, 12], [15, 15], [17, 18]];
const SELECTED_GLOW_STOPS = [[9, 12], [12, 17], [15, 22], [17, 26]];
const COLLECTED_HALO_STOPS = [[9, 7], [12, 11], [15, 14], [17, 16]];

/** Unrelated collectibles dim while a quest is active, but stay visible and clickable. */
const questOpacity = (full) => ["case", ["==", ["get", "questRelated"], false], ["*", full, 0.45], full];

const collectibleLayer = () => ({
  id: COLLECTIBLE_LAYER,
  type: "circle",
  source: COLLECTIBLE_SOURCE,
  paint: {
    "circle-radius": zoomSize(RADIUS_STOPS, SELECTED, 1.25),
    "circle-color": ["case", FILLED, VISITED_FILL, CATEGORY_FILL],
    "circle-opacity": questOpacity(["case", FILLED, 1, 0.88]),
    "circle-stroke-width": zoomSize(STROKE_STOPS, IS_RARE, 1.4),
    "circle-stroke-color": ["case",
      ["all", FILLED, ["!", IS_RARE]], "#0b0c0f",
      RARITY_RING],
    "circle-stroke-opacity": questOpacity(0.95)
  }
});

/**
 * A restrained halo that marks a collectible as collected on this activity replay. It is
 * presentation only and sits under the selection emphasis so collection reads as satisfying
 * but subtle, never arcade-like.
 */
const activityCollectedLayer = () => ({
  id: COLLECTIBLE_ACTIVITY_COLLECTED_LAYER,
  type: "circle",
  source: COLLECTIBLE_SOURCE,
  filter: ACTIVITY_COLLECTED,
  paint: {
    "circle-radius": zoomSize(COLLECTED_HALO_STOPS),
    "circle-color": SELECTED_ACCENT,
    "circle-opacity": 0.12,
    "circle-stroke-width": 1.5,
    "circle-stroke-color": SELECTED_ACCENT,
    "circle-stroke-opacity": 0.6
  }
});

const selectedGlowLayer = () => ({
  id: COLLECTIBLE_SELECTED_GLOW_LAYER,
  type: "circle",
  source: COLLECTIBLE_SOURCE,
  filter: SELECTED,
  paint: {
    "circle-radius": zoomSize(SELECTED_GLOW_STOPS),
    "circle-color": SELECTED_ACCENT,
    "circle-opacity": 0.08,
    "circle-stroke-width": 1,
    "circle-stroke-color": SELECTED_ACCENT,
    "circle-stroke-opacity": 0.28
  }
});

const selectedRingLayer = () => ({
  id: COLLECTIBLE_SELECTED_LAYER,
  type: "circle",
  source: COLLECTIBLE_SOURCE,
  filter: SELECTED,
  paint: {
    "circle-radius": zoomSize(SELECTED_RING_STOPS),
    "circle-color": SELECTED_ACCENT,
    "circle-opacity": 0.14,
    "circle-stroke-width": 2,
    "circle-stroke-color": SELECTED_ACCENT,
    "circle-stroke-opacity": 0.95
  }
});

/** The canonical collectible layers in draw order: base circle, activity-collected halo, selection. */
export const collectibleLayers = () => [
  collectibleLayer(),
  activityCollectedLayer(),
  selectedGlowLayer(),
  selectedRingLayer()
];

/**
 * Adds the canonical collectible source and its layers once. Layers are appended last so
 * collectibles draw above the basemap and any route, with selection emphasis on top.
 */
export const ensureCollectibleLayers = (map) => {
  if (map.getSource(COLLECTIBLE_SOURCE)) return;
  map.addSource(COLLECTIBLE_SOURCE, {
    type: "geojson",
    promoteId: "id",
    data: EMPTY_FEATURE_COLLECTION
  });
  for (const layer of collectibleLayers()) map.addLayer(layer);
};

export const setCollectibleData = (map, featureCollection) => {
  const source = map.getSource(COLLECTIBLE_SOURCE);
  if (!source) return false;
  source.setData(featureCollection ?? EMPTY_FEATURE_COLLECTION);
  return true;
};

const featureCollectibleId = (event) => event?.features?.[0]?.properties?.id;

/** Routes native layer events into the caller's selection flow. */
export const bindCollectibleInteractions = (map, { onSelect }) => {
  map.on("click", COLLECTIBLE_LAYER, (event) => {
    const id = featureCollectibleId(event);
    if (id === undefined) return;
    if (event.originalEvent?.stopPropagation) event.originalEvent.stopPropagation();
    onSelect(id);
  });
  map.on("mouseenter", COLLECTIBLE_LAYER, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", COLLECTIBLE_LAYER, () => {
    map.getCanvas().style.cursor = "";
  });
};
