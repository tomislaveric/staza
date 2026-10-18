/**
 * Shared, presentation-only geographic helpers and layer-order conventions for the Staza
 * map. Both World and Activity Detail use these so bounds, empty-geometry handling and draw
 * order stay consistent instead of being re-derived per screen.
 */

export const readBounds = (map) => {
  const bounds = map.getBounds();
  return {
    west: bounds.getWest(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    north: bounds.getNorth()
  };
};

export const boundsToParameter = (bounds) => [
  bounds.west, bounds.south, bounds.east, bounds.north
].map((value) => value.toFixed(5)).join(",");

/** Quest route feature: geometry is preserved as-is and never fabricated. */
export const routeToGeoJson = (route) => ({
  type: "Feature",
  properties: {},
  geometry: route?.geometry ?? { type: "LineString", coordinates: [] }
});

/** A LineString feature from an ordered list of [longitude, latitude] pairs. */
export const lineFeature = (coordinates = []) => ({
  type: "Feature",
  properties: {},
  geometry: { type: "LineString", coordinates }
});

/** A single Point feature; returns an empty collection-safe geometry when absent. */
export const pointFeature = (coordinate, properties = {}) => ({
  type: "Feature",
  properties,
  geometry: coordinate ? { type: "Point", coordinates: coordinate } : { type: "Point", coordinates: [] }
});

const isFinitePoint = (point) => Number.isFinite(point?.longitude) && Number.isFinite(point?.latitude);

/**
 * A `[[west, south], [east, north]]` bounding box from `{ longitude, latitude }` points, or
 * `undefined` when there is nothing to frame. Callers hand the result straight to
 * `map.fitBounds`, so empty geometry never throws.
 */
export const pointsToBounds = (points = []) => {
  const usable = points.filter(isFinitePoint);
  if (!usable.length) return undefined;
  return usable.reduce((box, point) => [
    [Math.min(box[0][0], point.longitude), Math.min(box[0][1], point.latitude)],
    [Math.max(box[1][0], point.longitude), Math.max(box[1][1], point.latitude)]
  ], [
    [usable[0].longitude, usable[0].latitude],
    [usable[0].longitude, usable[0].latitude]
  ]);
};

/**
 * Canonical draw order, bottom to top. Feature layers are inserted relative to these so
 * `beforeId` logic is not scattered across screens.
 *
 *   BASEMAP → ROUTE_BACKGROUND → ROUTE_PROGRESS → COLLECTIBLES → SELECTION → POSITION
 */
export const LAYER_ORDER = Object.freeze([
  "route-background",
  "route-progress",
  "collectibles",
  "selection",
  "position"
]);

const METERS_PER_DEGREE_LATITUDE = 111_320;

/**
 * Grows `{ west, south, east, north }` bounds around their center so they are at least `minKm`
 * wide and high (never shrinks). Longitude degrees are latitude-aware; results are clamped.
 */
export const expandBounds = (bounds, minKm = 200) => {
  const centerLatitude = (bounds.south + bounds.north) / 2;
  const centerLongitude = (bounds.west + bounds.east) / 2;
  const minHeight = (minKm * 1000) / METERS_PER_DEGREE_LATITUDE;
  const cosine = Math.max(Math.cos(centerLatitude * Math.PI / 180), 0.01);
  const minWidth = minHeight / cosine;
  const height = Math.max(bounds.north - bounds.south, minHeight);
  const width = Math.max(bounds.east - bounds.west, minWidth);
  return {
    west: Math.max(-180, centerLongitude - width / 2),
    south: Math.max(-90, centerLatitude - height / 2),
    east: Math.min(180, centerLongitude + width / 2),
    north: Math.min(90, centerLatitude + height / 2)
  };
};

/** Scales bounds around their center (factor 2 = twice as wide and high), clamped to the globe. */
export const scaleBounds = (bounds, factor) => {
  const longitudeInset = (bounds.east - bounds.west) * (factor - 1) / 2;
  const latitudeInset = (bounds.north - bounds.south) * (factor - 1) / 2;
  return {
    west: Math.max(-180, bounds.west - longitudeInset),
    south: Math.max(-90, bounds.south - latitudeInset),
    east: Math.min(180, bounds.east + longitudeInset),
    north: Math.min(90, bounds.north + latitudeInset)
  };
};

export const boundsContain = (outer, inner) =>
  inner.west >= outer.west && inner.east <= outer.east && inner.south >= outer.south && inner.north <= outer.north;

/** The centered fraction (0-1) of the bounds, used as the "safe" region of a truncated area load. */
export const centralBounds = (bounds, fraction) => {
  const longitudeInset = (bounds.east - bounds.west) * (1 - fraction) / 2;
  const latitudeInset = (bounds.north - bounds.south) * (1 - fraction) / 2;
  return {
    west: bounds.west + longitudeInset,
    south: bounds.south + latitudeInset,
    east: bounds.east - longitudeInset,
    north: bounds.north - latitudeInset
  };
};

/**
 * Whether the viewport can be served from the cached collectible area. A truncated area only
 * covers its center reliably, so the viewport must stay in the central half and not zoom in
 * beyond the view used to load that incomplete area.
 */
export const isServedByLoadedArea = (loaded, viewport) => {
  if (!loaded) return false;
  if (loaded.truncated && loaded.sourceViewport) {
    const loadedWidth = loaded.sourceViewport.east - loaded.sourceViewport.west;
    const loadedHeight = loaded.sourceViewport.north - loaded.sourceViewport.south;
    const viewportWidth = viewport.east - viewport.west;
    const viewportHeight = viewport.north - viewport.south;
    if (viewportWidth < loadedWidth || viewportHeight < loadedHeight) return false;
  }
  return boundsContain(loaded.truncated ? centralBounds(loaded.bounds, 0.5) : loaded.bounds, viewport);
};
