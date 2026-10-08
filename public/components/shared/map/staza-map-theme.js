/**
 * Staza map theme. Turns a provider basemap style into a muted Staza surface so that
 * collectibles, quests and routes lead visually. The transform is pure and category
 * driven: unknown provider layers pass through untouched, so a provider style update can
 * only under-theme the map, never break it.
 */

export const STAZA_DARK_PALETTE = {
  background: "#0f1114",
  water: "#16242e",
  waterLine: "#1d3140",
  waterLabel: "#6f8794",
  nature: "#16211b",
  natureAlt: "#19241c",
  landuse: "#121317",
  building: "#15171c",
  buildingOutline: "rgb(255 255 255 / 4%)",
  roadMajor: "#3a3e46",
  roadMinor: "#25282e",
  path: "#33373f",
  roadCasing: "#0f1114",
  rail: "#23262c",
  boundary: "rgb(255 255 255 / 10%)",
  labelPrimary: "#c9c4bb",
  labelSecondary: "#8a9099",
  labelMuted: "#7c828c",
  labelHalo: "#0b0c0f"
};

const HIDDEN_LAYERS = new Set([
  "poi_r1", "poi_r7", "poi_r20", "poi_transit",
  "highway-name-minor",
  "road_one_way_arrow", "road_one_way_arrow_opposite",
  "road_area_pattern", "park_outline"
]);

const WATER_FILL = new Set(["water"]);
const WATER_LINE = new Set(["waterway_river", "waterway_other", "waterway_tunnel"]);
const WATER_LABEL = new Set(["waterway_line_label", "water_name_point_label", "water_name_line_label"]);

const NATURE_FILL = new Set([
  "park", "landcover_wood", "landcover_grass", "landcover_wetland", "landcover_sand", "landcover_ice"
]);
const LANDUSE_FILL = new Set([
  "landuse_residential", "landuse_pitch", "landuse_track", "landuse_cemetery",
  "landuse_hospital", "landuse_school", "aeroway_fill"
]);

const PLACE_LABELS = new Set([
  "label_country_1", "label_country_2", "label_country_3", "label_state",
  "label_city", "label_city_capital", "label_town", "label_village", "label_other", "airport"
]);
const ROAD_LABELS = new Set([
  "highway-name-major", "highway-name-path", "highway-shield-non-us",
  "highway-shield-us-interstate", "road_shield_us"
]);
const PRIMARY_PLACE_LABELS = new Set(["label_country_1", "label_country_2", "label_city", "label_city_capital"]);

const BOUNDARY_LAYERS = new Set(["boundary_2", "boundary_3", "boundary_disputed"]);

const MAJOR_ROAD_SUFFIXES = ["motorway", "motorway_link", "trunk_primary"];
const PATH_SUFFIXES = ["path_pedestrian"];

const withoutPrefix = (id) => id.replace(/^(road|bridge|tunnel)_/, "");

const isRoadLayer = (layer) => layer["source-layer"] === "transportation" && layer.type === "line";
const isCasing = (id) => id.endsWith("_casing");
const isRail = (id) => id.includes("_rail");

/** Buckets a provider layer into the small set of categories the Staza palette knows. */
export const classifyLayer = (layer) => {
  const id = layer.id;
  if (HIDDEN_LAYERS.has(id)) return "hidden";
  if (id === "background") return "background";
  if (id === "natural_earth") return "relief";
  if (id === "building" || id === "building-3d") return "building";
  if (WATER_FILL.has(id)) return "water";
  if (WATER_LINE.has(id)) return "waterway";
  if (WATER_LABEL.has(id)) return "water-label";
  if (NATURE_FILL.has(id)) return "nature";
  if (LANDUSE_FILL.has(id)) return "landuse";
  if (BOUNDARY_LAYERS.has(id)) return "boundary";
  if (PLACE_LABELS.has(id)) return "place-label";
  if (ROAD_LABELS.has(id)) return "road-label";
  if (isRoadLayer(layer)) {
    if (isRail(id)) return "rail";
    if (isCasing(id)) return "road-casing";
    const base = withoutPrefix(id);
    if (PATH_SUFFIXES.some((suffix) => base.endsWith(suffix))) return "path";
    if (MAJOR_ROAD_SUFFIXES.some((suffix) => base === suffix)) return "road-major";
    return "road-minor";
  }
  if (id === "aeroway_runway" || id === "aeroway_taxiway") return "road-minor";
  return "other";
};

const labelPaint = (palette, id) => ({
  "text-color": PRIMARY_PLACE_LABELS.has(id) ? palette.labelPrimary : palette.labelSecondary,
  "text-halo-color": palette.labelHalo,
  "text-halo-width": 1.2,
  "text-halo-blur": 0.4
});

const paintFor = (category, layer, palette) => {
  switch (category) {
    case "background":
      return { "background-color": palette.background };
    case "relief":
      return { "raster-opacity": 0.18, "raster-saturation": -0.7, "raster-brightness-max": 0.35 };
    case "water":
      return { "fill-color": palette.water, "fill-opacity": 1 };
    case "waterway":
      return { "line-color": palette.waterLine };
    case "water-label":
      return { ...labelPaint(palette, layer.id), "text-color": palette.waterLabel };
    case "nature":
      const natureColor = layer.id === "park" ? palette.natureAlt : palette.nature;
      return { "fill-color": natureColor, "fill-outline-color": natureColor, "fill-opacity": 0.85 };
    case "landuse":
      return { "fill-color": palette.landuse, "fill-opacity": 0.8 };
    case "building":
      return layer.type === "fill-extrusion"
        ? { "fill-extrusion-color": palette.building, "fill-extrusion-opacity": 0.6 }
        : { "fill-color": palette.building, "fill-outline-color": palette.buildingOutline };
    case "road-major":
      return { "line-color": palette.roadMajor };
    case "road-minor":
      return { "line-color": palette.roadMinor };
    case "path":
      return { "line-color": palette.path };
    case "road-casing":
      return { "line-color": palette.roadCasing };
    case "rail":
      return { "line-color": palette.rail };
    case "boundary":
      return { "line-color": palette.boundary };
    case "place-label":
    case "road-label":
      return labelPaint(palette, layer.id);
    default:
      return undefined;
  }
};

const themeLayer = (layer, palette) => {
  const category = classifyLayer(layer);
  if (category === "hidden") {
    return { ...layer, layout: { ...layer.layout, visibility: "none" } };
  }
  const paint = paintFor(category, layer, palette);
  if (!paint) return layer;
  return { ...layer, paint: { ...layer.paint, ...paint } };
};

/**
 * Returns a Staza-themed copy of a provider style. Sources, sprite, glyphs, layer order,
 * filters and zoom ranges are preserved so the provider stays replaceable.
 */
export const applyStazaMapTheme = (style, palette = STAZA_DARK_PALETTE) => {
  if (!style || !Array.isArray(style.layers)) throw new Error("A basemap style with layers is required.");
  return { ...style, layers: style.layers.map((layer) => themeLayer(layer, palette)) };
};
