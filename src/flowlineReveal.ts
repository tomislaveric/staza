import { primaryScore, type FlowlineScores } from "./flowlineCharacter.js";
import { METERS_PER_DEGREE_LATITUDE, viewportWidthMeters } from "./flowlinePolicy.js";
import type { GeoBounds } from "./worldQuery.js";

/**
 * Flowline opportunities one "Explore this area" shows at most. Opportunities are temporary:
 * Explore persists nothing, so the same area always shows the same opportunities.
 */
export const FLOWLINE_OPPORTUNITIES_PER_EXPLORE = 12;
/** Widest area one Explore covers; wider viewports explore a centered frame of this width. */
export const MAX_EXPLORE_WIDTH_METERS = 50_000;
/** Tallest area one Explore covers (portrait phones see more height than width). */
export const MAX_EXPLORE_HEIGHT_METERS = 100_000;
/** Largest radius of a circular Explore area (the width limit's half). */
export const MAX_EXPLORE_RADIUS_METERS = MAX_EXPLORE_WIDTH_METERS / 2;
/** Minimum primary-character score of a Flowline worth showing as an opportunity. */
export const MIN_OPPORTUNITY_SCORE = 50;
/** Minimum road quality, when scored. */
export const MIN_OPPORTUNITY_ROAD_QUALITY = 40;
/** Minimum data confidence, when scored. */
export const MIN_OPPORTUNITY_DATA_CONFIDENCE = 40;

export interface OpportunityCandidate extends FlowlineScores {
  id: string;
  roadQualityScore?: number;
  dataConfidence?: number;
}

/** Published Flowlines Explore may show: good enough to ride and trustworthy enough to show. */
export const isOpportunityEligible = (candidate: OpportunityCandidate): boolean =>
  primaryScore(candidate) >= MIN_OPPORTUNITY_SCORE
  && (candidate.roadQualityScore === undefined || candidate.roadQualityScore >= MIN_OPPORTUNITY_ROAD_QUALITY)
  && (candidate.dataConfidence === undefined || candidate.dataConfidence >= MIN_OPPORTUNITY_DATA_CONFIDENCE);

const byPrimaryScore = (a: OpportunityCandidate, b: OpportunityCandidate) =>
  primaryScore(b) - primaryScore(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Eligible candidates not in `excludedIds` (the player's completed Flowlines), best first, ties by id. */
export const availableOpportunities = <T extends OpportunityCandidate>(candidates: T[], excludedIds: ReadonlySet<string>): T[] =>
  candidates.filter((candidate) => !excludedIds.has(candidate.id) && isOpportunityEligible(candidate)).sort(byPrimaryScore);

/** The Flowline opportunities one Explore shows, up to the cap. */
export const selectFlowlineOpportunities = <T extends OpportunityCandidate>(
  candidates: T[],
  excludedIds: ReadonlySet<string>,
  count: number = FLOWLINE_OPPORTUNITIES_PER_EXPLORE
): T[] => availableOpportunities(candidates, excludedIds).slice(0, Math.max(0, count));

/**
 * Flowlines a route may use: the area's eligible opportunities and the player's completed ones.
 * Planning is stateless, so this replaces any persisted reveal check.
 */
export const isPlannableFlowline = (candidate: OpportunityCandidate, completed: boolean): boolean =>
  completed || isOpportunityEligible(candidate);

export const exploreAllowed = (bounds: GeoBounds): boolean => viewportWidthMeters(bounds) <= MAX_EXPLORE_WIDTH_METERS;

export interface ExploreCircle {
  center: { lat: number; lon: number };
  radiusMeters: number;
}

export interface ExploreFrame {
  bounds: GeoBounds;
  center: { lat: number; lon: number };
  /** True when the requested area was larger than one Explore and was cut to the maximum size. */
  clamped: boolean;
  /** A circular area: only what lies inside it is explored; `bounds` encloses it. */
  circle?: ExploreCircle;
}

const wrapLongitude = (lon: number) => (lon > 180 ? lon - 360 : lon < -180 ? lon + 360 : lon);
const metersPerDegreeLongitude = (latitude: number) =>
  METERS_PER_DEGREE_LATITUDE * Math.max(Math.cos((latitude * Math.PI) / 180), 1e-6);

/** A circular Explore area, its radius capped at MAX_EXPLORE_RADIUS_METERS. */
export const clampExploreCircle = (circle: ExploreCircle): ExploreFrame => {
  const clamped = circle.radiusMeters > MAX_EXPLORE_RADIUS_METERS;
  const radiusMeters = Math.min(circle.radiusMeters, MAX_EXPLORE_RADIUS_METERS);
  const { lat, lon } = circle.center;
  const halfLat = radiusMeters / METERS_PER_DEGREE_LATITUDE;
  const halfLon = radiusMeters / metersPerDegreeLongitude(lat);
  return {
    bounds: {
      minLatitude: Math.max(-90, lat - halfLat),
      maxLatitude: Math.min(90, lat + halfLat),
      minLongitude: wrapLongitude(lon - halfLon),
      maxLongitude: wrapLongitude(lon + halfLon)
    },
    center: { lat, lon },
    clamped,
    circle: { center: { lat, lon }, radiusMeters }
  };
};

/** Local planar meters around the circle's center; accurate at Explore sizes. */
const toLocal = (circle: ExploreCircle, [lon, lat]: [number, number]) => {
  let deltaLon = lon - circle.center.lon;
  if (deltaLon > 180) deltaLon -= 360;
  if (deltaLon < -180) deltaLon += 360;
  return { x: deltaLon * metersPerDegreeLongitude(circle.center.lat), y: (lat - circle.center.lat) * METERS_PER_DEGREE_LATITUDE };
};

export const pointInCircle = (circle: ExploreCircle, lon: number, lat: number): boolean => {
  const { x, y } = toLocal(circle, [lon, lat]);
  return Math.hypot(x, y) <= circle.radiusMeters;
};

/** True when any part of the line (vertices or segments between them) lies inside the circle. */
export const lineTouchesCircle = (circle: ExploreCircle, coordinates: [number, number][]): boolean => {
  const points = coordinates.map((coordinate) => toLocal(circle, coordinate));
  if (points.some(({ x, y }) => Math.hypot(x, y) <= circle.radiusMeters)) return true;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1], b = points[index];
    const dx = b.x - a.x, dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lengthSquared));
    if (Math.hypot(a.x + t * dx, a.y + t * dy) <= circle.radiusMeters) return true;
  }
  return false;
};

/**
 * The area one "Explore this area" covers: the viewport itself, or — when it is larger than
 * MAX_EXPLORE_WIDTH_METERS × MAX_EXPLORE_HEIGHT_METERS — a frame of at most that size centered
 * on the viewport. Explore is therefore always possible.
 */
export const clampExploreBounds = (bounds: GeoBounds): ExploreFrame => {
  const lonSpan = bounds.maxLongitude >= bounds.minLongitude
    ? bounds.maxLongitude - bounds.minLongitude
    : bounds.maxLongitude + 360 - bounds.minLongitude;
  const centerLat = (bounds.minLatitude + bounds.maxLatitude) / 2;
  const rawCenterLon = bounds.minLongitude + lonSpan / 2;
  const centerLon = rawCenterLon > 180 ? rawCenterLon - 360 : rawCenterLon;
  const metersPerDegreeLon = metersPerDegreeLongitude(centerLat);
  const maxLonSpan = MAX_EXPLORE_WIDTH_METERS / metersPerDegreeLon;
  const maxLatSpan = MAX_EXPLORE_HEIGHT_METERS / METERS_PER_DEGREE_LATITUDE;
  const latSpan = bounds.maxLatitude - bounds.minLatitude;
  const clamped = lonSpan > maxLonSpan || latSpan > maxLatSpan;
  if (!clamped) return { bounds, center: { lat: centerLat, lon: centerLon }, clamped };
  const halfLon = Math.min(lonSpan, maxLonSpan) / 2;
  const halfLat = Math.min(latSpan, maxLatSpan) / 2;
  return {
    bounds: {
      minLatitude: centerLat - halfLat,
      maxLatitude: centerLat + halfLat,
      minLongitude: wrapLongitude(centerLon - halfLon),
      maxLongitude: wrapLongitude(centerLon + halfLon)
    },
    center: { lat: centerLat, lon: centerLon },
    clamped
  };
};

export type ExploreOutcome = "discovered" | "nothing_new";

export const exploreOutcome = (opportunities: number): ExploreOutcome => (opportunities > 0 ? "discovered" : "nothing_new");
