/**
 * Object classes imported from OpenStreetMap for the Fartlek way-geometry extraction mode.
 * Unlike `selectors.ts` (point-centroid collectibles), this selector set keeps full `LineString`
 * geometry for `highway` ways plus single-point boundary/traffic-control nodes used by candidate
 * generation (`fartlekCandidates.ts`).
 */

/** Highway classes plausible for a cycling Fartlek. Unsuitable classes (motorway, trunk, ...) are
 * deliberately excluded from extraction — they would be hard-rejected by scoring anyway. */
export const FARTLEK_HIGHWAY_CLASSES = new Set([
  "primary", "primary_link",
  "secondary", "secondary_link",
  "tertiary", "tertiary_link",
  "unclassified", "residential", "cycleway"
]);

/** Node tags marking a logical segment boundary (candidate generation walks between these). */
export const FARTLEK_BOUNDARY_NODE_TAGS: [string, string][] = [
  ["traffic_sign", "city_limit"]
];

/** Node tags marking traffic-control features, counted for `trafficControlCount`. */
export const FARTLEK_CONTROL_NODE_TAGS: [string, string][] = [
  ["highway", "traffic_signals"],
  ["highway", "stop"],
  ["highway", "give_way"],
  ["traffic_calming", "*"]
];

export const FARTLEK_RETAINED_WAY_TAG_KEYS = new Set([
  "highway", "name", "ref", "surface", "smoothness", "bicycle", "access", "maxspeed",
  "priority_road", "lit", "landuse", "junction"
]);

export const FARTLEK_RETAINED_NODE_TAG_KEYS = new Set([
  "traffic_sign", "highway", "traffic_calming", "name"
]);

export const matchesFartlekWayClass = (tags: Record<string, string>): boolean =>
  typeof tags.highway === "string" && FARTLEK_HIGHWAY_CLASSES.has(tags.highway);

export const matchesFartlekBoundaryNode = (tags: Record<string, string>): boolean =>
  FARTLEK_BOUNDARY_NODE_TAGS.some(([key, value]) => tags[key] === value);

export const matchesFartlekControlNode = (tags: Record<string, string>): boolean =>
  FARTLEK_CONTROL_NODE_TAGS.some(([key, value]) => value === "*" ? tags[key] !== undefined : tags[key] === value);

export const isRetainedFartlekWayTagKey = (key: string): boolean => FARTLEK_RETAINED_WAY_TAG_KEYS.has(key);

export const isRetainedFartlekNodeTagKey = (key: string): boolean => FARTLEK_RETAINED_NODE_TAG_KEYS.has(key);
