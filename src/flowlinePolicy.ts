import type { GeoBounds } from "./worldQuery.js";

export interface FlowlineViewportPolicy {
  minLengthMeters: number;
  limit: number;
}

const METERS_PER_DEGREE_LATITUDE = 111_320;
/** Up to this viewport width every Flowline is shown; wider viewports show a shrinking share. */
export const FULL_DETAIL_WIDTH_METERS = 100_000;
const MAX_MIN_LENGTH_METERS = 6_000;

export const viewportWidthMeters = (bounds: GeoBounds): number => {
  const centerLatitude = (bounds.minLatitude + bounds.maxLatitude) / 2;
  const span = bounds.maxLongitude >= bounds.minLongitude
    ? bounds.maxLongitude - bounds.minLongitude
    : bounds.maxLongitude + 360 - bounds.minLongitude;
  return span * METERS_PER_DEGREE_LATITUDE * Math.cos(centerLatitude * Math.PI / 180);
};

/**
 * Viewport up to 100 km wide: all Flowlines (bounded only by the safety cap). Wider: the share
 * falls as 100 km / width, and short Flowlines are dropped first.
 */
export const flowlinePolicyForBounds = (bounds: GeoBounds, maxLimit: number): FlowlineViewportPolicy => {
  const width = viewportWidthMeters(bounds);
  if (!(width > FULL_DETAIL_WIDTH_METERS)) return { minLengthMeters: 0, limit: maxLimit };
  const share = FULL_DETAIL_WIDTH_METERS / width;
  return {
    minLengthMeters: Math.min(MAX_MIN_LENGTH_METERS, Math.round((width / FULL_DETAIL_WIDTH_METERS - 1) * 1_000)),
    limit: Math.max(1, Math.round(maxLimit * share))
  };
};
