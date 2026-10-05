/**
 * Object classes imported from OpenStreetMap and the tag keys kept for scoring
 * and catalog presentation. The extract snapshot builder filters on both.
 */
export const OSM_SOURCE_CLASSES = [
  ["tourism", "viewpoint"],
  ["natural", "peak"],
  ["historic", "castle"],
  ["waterway", "waterfall"],
  ["place", "square"],
  ["place", "quarter"],
  ["tourism", "attraction"]
] as const;

export const OSM_RETAINED_TAG_KEYS = new Set([
  "name", "name:de", "name:en", "wikidata", "wikipedia", "access", "foot",
  "highway", "ele", "prominence", "prominence:peak", "direction",
  "camera:direction", "observation", "castle_type", "tourism", "heritage",
  "heritage:operator", "historic", "natural", "waterway", "height", "website",
  "ref", "contact:website", "place", "operator", "description", "start_date",
  "wikimedia_commons"
]);

export const isRetainedTagKey = (key: string): boolean =>
  OSM_RETAINED_TAG_KEYS.has(key) || key.startsWith("observation:");

export const matchesSourceClass = (tags: Record<string, string>): boolean =>
  OSM_SOURCE_CLASSES.some(([key, value]) => tags[key] === value);
