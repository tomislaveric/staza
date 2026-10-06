import type { Collectible, TrackPoint } from "./domain.js";
import { UserInputError } from "./errors.js";

const METERS_PER_DEGREE_LATITUDE = 111_320;
const MINIMUM_COSINE = 1e-6;

export interface GeoBounds {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}

export const getRouteBounds = (route: TrackPoint[]): GeoBounds | undefined => {
  if (route.length === 0) return undefined;
  return route.reduce<GeoBounds>(
    (bounds, point) => ({
      minLatitude: Math.min(bounds.minLatitude, point.latitude),
      maxLatitude: Math.max(bounds.maxLatitude, point.latitude),
      minLongitude: Math.min(bounds.minLongitude, point.longitude),
      maxLongitude: Math.max(bounds.maxLongitude, point.longitude)
    }),
    {
      minLatitude: route[0].latitude,
      maxLatitude: route[0].latitude,
      minLongitude: route[0].longitude,
      maxLongitude: route[0].longitude
    }
  );
};

export const padGeoBounds = (bounds: GeoBounds, paddingMeters: number): GeoBounds => {
  const latitudePadding = paddingMeters / METERS_PER_DEGREE_LATITUDE;
  const centerLatitudeRadians = ((bounds.minLatitude + bounds.maxLatitude) / 2) * Math.PI / 180;
  const longitudePadding = paddingMeters / (
    METERS_PER_DEGREE_LATITUDE * Math.max(Math.abs(Math.cos(centerLatitudeRadians)), MINIMUM_COSINE)
  );
  return {
    minLatitude: Math.max(-90, bounds.minLatitude - latitudePadding),
    maxLatitude: Math.min(90, bounds.maxLatitude + latitudePadding),
    minLongitude: bounds.minLongitude - longitudePadding,
    maxLongitude: bounds.maxLongitude + longitudePadding
  };
};

export const getRelevantCollectibles = (
  allCollectibles: Collectible[],
  route: TrackPoint[],
  paddingMeters: number
): Collectible[] => {
  const bounds = getRouteBounds(route);
  if (!bounds) return [];
  return allCollectibles.filter((collectible) => {
    const paddedBounds = padGeoBounds(bounds, paddingMeters + collectible.radiusMeters);
    return collectible.latitude >= paddedBounds.minLatitude &&
      collectible.latitude <= paddedBounds.maxLatitude &&
      collectible.longitude >= paddedBounds.minLongitude &&
      collectible.longitude <= paddedBounds.maxLongitude;
  });
};

/** Fartleks whose geometry touches the padded route bbox, mirroring getRelevantCollectibles. */
export const getRelevantFartleks = <T extends { geometry: { coordinates: [number, number][] } }>(
  allFartleks: T[],
  route: TrackPoint[],
  paddingMeters: number
): T[] => {
  const bounds = getRouteBounds(route);
  if (!bounds) return [];
  const paddedBounds = padGeoBounds(bounds, paddingMeters);
  return allFartleks.filter((fartlek) =>
    fartlek.geometry.coordinates.some(([longitude, latitude]) => isWithinBounds({ latitude, longitude }, paddedBounds)));
};

export interface LongitudeRange {
  minLongitude: number;
  maxLongitude: number;
}

/** Splits viewport bounds that cross the antimeridian into inclusive longitude ranges. */
export const splitBoundsAtAntimeridian = (bounds: GeoBounds): LongitudeRange[] => {
  if (bounds.minLongitude <= bounds.maxLongitude) {
    return [{ minLongitude: bounds.minLongitude, maxLongitude: bounds.maxLongitude }];
  }
  return [
    { minLongitude: bounds.minLongitude, maxLongitude: 180 },
    { minLongitude: -180, maxLongitude: bounds.maxLongitude }
  ];
};

export const isWithinBounds = (
  point: Pick<Collectible, "latitude" | "longitude">,
  bounds: GeoBounds
): boolean => {
  if (point.latitude < bounds.minLatitude || point.latitude > bounds.maxLatitude) return false;
  return splitBoundsAtAntimeridian(bounds).some((range) =>
    point.longitude >= range.minLongitude && point.longitude <= range.maxLongitude);
};

export const filterCollectiblesByBounds = <T extends Pick<Collectible, "latitude" | "longitude">>(
  collectibles: T[],
  bounds: GeoBounds
): T[] => collectibles.filter((collectible) => isWithinBounds(collectible, bounds));

export const boundsCenter = (bounds: GeoBounds): { latitude: number; longitude: number } => {
  const latitude = (bounds.minLatitude + bounds.maxLatitude) / 2;
  if (bounds.minLongitude <= bounds.maxLongitude) {
    return { latitude, longitude: (bounds.minLongitude + bounds.maxLongitude) / 2 };
  }
  const span = 180 - bounds.minLongitude + (bounds.maxLongitude + 180);
  const center = bounds.minLongitude + span / 2;
  return { latitude, longitude: center > 180 ? center - 360 : center };
};

/** Keeps the entries nearest the viewport centre when a viewport holds more than the cap. */
export const limitToViewportCap = <T extends Pick<Collectible, "latitude" | "longitude">>(
  collectibles: T[],
  bounds: GeoBounds,
  limit: number
): { collectibles: T[]; truncated: boolean } => {
  if (collectibles.length <= limit) return { collectibles, truncated: false };
  const center = boundsCenter(bounds);
  const ranked = [...collectibles].sort((left, right) =>
    ((left.latitude - center.latitude) ** 2 + (left.longitude - center.longitude) ** 2) -
    ((right.latitude - center.latitude) ** 2 + (right.longitude - center.longitude) ** 2));
  return { collectibles: ranked.slice(0, limit), truncated: true };
};

export const parseBoundsParameter = (value: unknown): GeoBounds | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new UserInputError("bbox must be west,south,east,north.");
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new UserInputError("bbox must be west,south,east,north.");
  }
  const [west, south, east, north] = parts;
  if (south < -90 || south > 90 || north < -90 || north > 90) {
    throw new UserInputError("bbox latitudes must be between -90 and 90.");
  }
  if (west < -180 || west > 180 || east < -180 || east > 180) {
    throw new UserInputError("bbox longitudes must be between -180 and 180.");
  }
  if (south > north) throw new UserInputError("bbox south must not be greater than north.");
  return { minLatitude: south, maxLatitude: north, minLongitude: west, maxLongitude: east };
};
