import { EMPTY_FEATURE_COLLECTION } from "./staza-collectible-features.js";

export const COLLECTIBLE_SOURCE = "staza-collectibles";
export const COLLECTIBLE_LAYER = "staza-collectibles";
export const COLLECTIBLE_CATEGORY_ICON_LAYER = "staza-collectible-category-icons";
export const COLLECTIBLE_ACTIVITY_COLLECTED_LAYER = "staza-collectibles-activity-collected";
export const COLLECTIBLE_SELECTED_GLOW_LAYER = "staza-collectibles-selected-glow";
export const COLLECTIBLE_SELECTED_LAYER = "staza-collectibles-selected";
export const COLLECTIBLE_CATEGORY_ICONS = [
  ["collectible-castle", "/assets/collectible-castle.svg"],
  ["collectible-castle-muted", "/assets/collectible-castle-muted.svg"],
  ["collectible-mountain-pass", "/assets/collectible-mountain-pass.svg"],
  ["collectible-mountain-pass-muted", "/assets/collectible-mountain-pass-muted.svg"],
  ["collectible-peak", "/assets/collectible-peak.svg"],
  ["collectible-peak-muted", "/assets/collectible-peak-muted.svg"],
  ["collectible-place", "/assets/collectible-place.svg"],
  ["collectible-place-muted", "/assets/collectible-place-muted.svg"],
  ["collectible-viewpoint", "/assets/collectible-viewpoint.svg"],
  ["collectible-viewpoint-muted", "/assets/collectible-viewpoint-muted.svg"],
  ["collectible-waterfall", "/assets/collectible-waterfall.svg"],
  ["collectible-waterfall-muted", "/assets/collectible-waterfall-muted.svg"]
];

const VISITED_FILL = "#e8b80a";
const UNVISITED_FILL = "#315b68";
const UNVISITED_RING = "#7fbad0";
const SELECTED_ACCENT = "#e8b80a";

const SELECTED = ["==", ["get", "selected"], true];
const QUEST_TARGET = ["==", ["get", "questTarget"], true];
const SELECTED_OR_QUEST_TARGET = ["any", SELECTED, QUEST_TARGET];
const ACTIVITY_COLLECTED = ["==", ["get", "activityCollected"], true];
/** Visited state stays gold; unvisited circle markers retain neutral category fallback colors. */
const FILLED = ["any", ["get", "visited"], ACTIVITY_COLLECTED];
const HAS_CATEGORY_ICON = ["any",
  ["==", ["get", "category"], "castle"],
  ["==", ["get", "category"], "mountain_pass"],
  ["==", ["get", "category"], "peak"],
  ["==", ["get", "category"], "viewpoint"],
  ["==", ["get", "category"], "place"],
  ["==", ["get", "category"], "waterfall"]];
const NO_CATEGORY_ICON = ["!", HAS_CATEGORY_ICON];
const CATEGORY_ICON_IMAGE = ["match", ["get", "category"],
  "castle", ["case", FILLED, "collectible-castle", "collectible-castle-muted"],
  "mountain_pass", ["case", FILLED, "collectible-mountain-pass", "collectible-mountain-pass-muted"],
  "peak", ["case", FILLED, "collectible-peak", "collectible-peak-muted"],
  "viewpoint", ["case", FILLED, "collectible-viewpoint", "collectible-viewpoint-muted"],
  "place", ["case", FILLED, "collectible-place", "collectible-place-muted"],
  "waterfall", ["case", FILLED, "collectible-waterfall", "collectible-waterfall-muted"],
  ""];

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
  filter: NO_CATEGORY_ICON,
  paint: {
    "circle-radius": zoomSize(RADIUS_STOPS, SELECTED_OR_QUEST_TARGET, 1.25),
    "circle-color": ["case", FILLED, VISITED_FILL, UNVISITED_FILL],
    "circle-opacity": questOpacity(["case", FILLED, 1, 0.88]),
    "circle-stroke-width": zoomSize(STROKE_STOPS),
    "circle-stroke-color": ["case", FILLED, "#0b0c0f", UNVISITED_RING],
    "circle-stroke-opacity": questOpacity(0.95)
  }
});

const categoryIconLayer = () => ({
  id: COLLECTIBLE_CATEGORY_ICON_LAYER,
  type: "symbol",
  source: COLLECTIBLE_SOURCE,
  filter: HAS_CATEGORY_ICON,
  layout: {
    "icon-image": CATEGORY_ICON_IMAGE,
    "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.67, 12, 0.83, 15, 1, 17, 1.17],
    "icon-allow-overlap": true,
    "icon-ignore-placement": true
  },
  paint: {
    "icon-opacity": questOpacity(["case", FILLED, 1, 0.88])
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
  filter: SELECTED_OR_QUEST_TARGET,
  paint: {
    "circle-radius": zoomSize(SELECTED_GLOW_STOPS, SELECTED, 1.35),
    "circle-color": ["case", SELECTED, "#fff1a8", SELECTED_ACCENT],
    "circle-opacity": ["case", SELECTED, 0.2, 0.08],
    "circle-stroke-width": 1,
    "circle-stroke-color": ["case", SELECTED, "#fff1a8", SELECTED_ACCENT],
    "circle-stroke-opacity": ["case", SELECTED, 0.8, 0.28]
  }
});

const selectedRingLayer = () => ({
  id: COLLECTIBLE_SELECTED_LAYER,
  type: "circle",
  source: COLLECTIBLE_SOURCE,
  filter: SELECTED_OR_QUEST_TARGET,
  paint: {
    "circle-radius": zoomSize(SELECTED_RING_STOPS, SELECTED, 1.25),
    "circle-color": ["case", SELECTED, "#fff1a8", SELECTED_ACCENT],
    "circle-opacity": ["case", SELECTED, 0.28, 0.14],
    "circle-stroke-width": ["case", SELECTED, 3, 2],
    "circle-stroke-color": ["case", SELECTED, "#fff1a8", SELECTED_ACCENT],
    "circle-stroke-opacity": 0.95
  }
});

/** The canonical collectible layers in draw order: markers, collection halo, selection, category icons. */
export const collectibleLayers = () => [
  collectibleLayer(),
  activityCollectedLayer(),
  selectedGlowLayer(),
  selectedRingLayer(),
  categoryIconLayer()
];

const loadSvgImage = (url) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => {
    image.onload = null;
    image.onerror = null;
    resolve(image);
  };
  image.onerror = () => {
    image.onload = null;
    image.onerror = null;
    reject(new Error(`Unable to load collectible icon: ${url}`));
  };
  image.src = url;
});

export const loadCollectibleCategoryIcons = async (map, imageLoader = loadSvgImage) => {
  const images = await Promise.all(COLLECTIBLE_CATEGORY_ICONS.map(async ([id, url]) => {
    if (map.hasImage(id)) return undefined;
    const image = await imageLoader(url);
    return { id, image };
  }));

  for (const image of images) {
    if (image && !map.hasImage(image.id)) map.addImage(image.id, image.image);
  }
};

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
export const bindCollectibleInteractions = (map, { onSelect, onHover }) => {
  for (const layer of [COLLECTIBLE_LAYER, COLLECTIBLE_CATEGORY_ICON_LAYER]) {
    map.on("click", layer, (event) => {
      const id = featureCollectibleId(event);
      if (id === undefined) return;
      if (event.originalEvent?.stopPropagation) event.originalEvent.stopPropagation();
      onSelect(id);
    });
    map.on("mouseenter", layer, (event) => {
      map.getCanvas().style.cursor = "pointer";
      if (onHover) onHover(featureCollectibleId(event));
    });
    map.on("mouseleave", layer, () => {
      map.getCanvas().style.cursor = "";
      if (onHover) onHover(undefined);
    });
  }
};
