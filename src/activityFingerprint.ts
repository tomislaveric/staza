import type { ActivityType, TrackPoint } from "./domain.js";
import { distanceMeters } from "./geometry.js";

/**
 * Versioned, source-independent identity of a completed activity. It is used to recognize the
 * same real-world activity imported through different sources (for example a FIT upload and the
 * Strava copy of that ride) so gameplay cannot be awarded twice.
 */
export const ACTIVITY_FINGERPRINT_VERSION = 1;
export const FINGERPRINT_ROUTE_SAMPLES = 32;
const ROUTE_QUANTUM_DEGREES = 1e-4;
const DURATION_BUCKET_SECONDS = 60;
const DISTANCE_BUCKET_METERS = 100;

const START_TOLERANCE_MS = 120_000;
const DURATION_TOLERANCE_SECONDS = 120;
const DURATION_TOLERANCE_RATIO = 0.05;
const DISTANCE_TOLERANCE_METERS = 250;
const DISTANCE_TOLERANCE_RATIO = 0.05;
const ROUTE_MEAN_TOLERANCE_METERS = 50;
const ROUTE_MAX_TOLERANCE_METERS = 250;
/** Candidate window used by persistence to narrow the duplicate search before comparing routes. */
export const FINGERPRINT_CANDIDATE_WINDOW_MS = 5 * 60_000;

export interface ActivityFingerprint {
  version: typeof ACTIVITY_FINGERPRINT_VERSION;
  activityType: ActivityType;
  startMinuteMs: number;
  startedAtMs: number;
  durationSeconds: number;
  durationBucket: number;
  distanceMeters: number;
  distanceBucket: number;
  /** Distance-resampled route quantized to ~11 m, as [latitude, longitude] pairs. */
  route: [number, number][];
}

const quantize = (value: number): number =>
  Number((Math.round(value / ROUTE_QUANTUM_DEGREES) * ROUTE_QUANTUM_DEGREES).toFixed(4));

export const routeDistanceMeters = (route: Pick<TrackPoint, "latitude" | "longitude">[]): number =>
  route.slice(1).reduce(
    (total, point, index) =>
      total + distanceMeters(route[index].latitude, route[index].longitude, point.latitude, point.longitude),
    0
  );

const resampleRoute = (route: TrackPoint[], samples: number): [number, number][] => {
  const cumulative = [0];
  for (let index = 1; index < route.length; index += 1) {
    const previous = route[index - 1];
    const point = route[index];
    cumulative.push(cumulative[index - 1] + distanceMeters(previous.latitude, previous.longitude, point.latitude, point.longitude));
  }
  const total = cumulative.at(-1)!;
  const result: [number, number][] = [];
  let segment = 0;
  for (let sample = 0; sample < samples; sample += 1) {
    const target = samples === 1 ? 0 : (total * sample) / (samples - 1);
    while (segment < route.length - 2 && cumulative[segment + 1] < target) segment += 1;
    const start = route[segment];
    const end = route[Math.min(segment + 1, route.length - 1)];
    const span = cumulative[Math.min(segment + 1, route.length - 1)] - cumulative[segment];
    const ratio = span > 0 ? Math.min(1, Math.max(0, (target - cumulative[segment]) / span)) : 0;
    result.push([
      quantize(start.latitude + (end.latitude - start.latitude) * ratio),
      quantize(start.longitude + (end.longitude - start.longitude) * ratio)
    ]);
  }
  return result;
};

export const createActivityFingerprint = (activity: {
  type: ActivityType;
  route: TrackPoint[];
}): ActivityFingerprint | undefined => {
  const route = activity.route.filter((point) =>
    Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && Number.isFinite(point.timestampMs));
  if (route.length < 2) return undefined;
  const startedAtMs = route[0].timestampMs;
  const durationSeconds = Math.max(0, (route.at(-1)!.timestampMs - startedAtMs) / 1000);
  const distance = routeDistanceMeters(route);
  return {
    version: ACTIVITY_FINGERPRINT_VERSION,
    activityType: activity.type,
    startMinuteMs: Math.round(startedAtMs / 60_000) * 60_000,
    startedAtMs,
    durationSeconds,
    durationBucket: Math.round(durationSeconds / DURATION_BUCKET_SECONDS),
    distanceMeters: distance,
    distanceBucket: Math.round(distance / DISTANCE_BUCKET_METERS),
    route: resampleRoute(route, FINGERPRINT_ROUTE_SAMPLES)
  };
};

const compatibleTypes = (left: ActivityType, right: ActivityType): boolean =>
  left === right || left === "unknown" || right === "unknown";

const withinTolerance = (left: number, right: number, absolute: number, ratio: number): boolean =>
  Math.abs(left - right) <= Math.max(absolute, ratio * Math.max(left, right));

/**
 * True only for a high-confidence match: the same start time, duration, distance, and route shape
 * within tolerances that absorb device/provider sampling differences. Unknown activity types are
 * treated as compatible because FIT imports do not always carry a sport.
 */
export const isHighConfidenceDuplicate = (left: ActivityFingerprint, right: ActivityFingerprint): boolean => {
  if (left.version !== right.version || left.route.length !== right.route.length || left.route.length === 0) return false;
  if (!compatibleTypes(left.activityType, right.activityType)) return false;
  if (Math.abs(left.startedAtMs - right.startedAtMs) > START_TOLERANCE_MS) return false;
  if (!withinTolerance(left.durationSeconds, right.durationSeconds, DURATION_TOLERANCE_SECONDS, DURATION_TOLERANCE_RATIO)) return false;
  if (!withinTolerance(left.distanceMeters, right.distanceMeters, DISTANCE_TOLERANCE_METERS, DISTANCE_TOLERANCE_RATIO)) return false;
  let total = 0;
  let maximum = 0;
  for (let index = 0; index < left.route.length; index += 1) {
    const gap = distanceMeters(left.route[index][0], left.route[index][1], right.route[index][0], right.route[index][1]);
    total += gap;
    maximum = Math.max(maximum, gap);
  }
  return total / left.route.length <= ROUTE_MEAN_TOLERANCE_METERS && maximum <= ROUTE_MAX_TOLERANCE_METERS;
};
