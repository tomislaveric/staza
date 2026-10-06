import type { Fartlek, FartlekCompletion, FartlekCompletionDraft, FartlekGeometry, WorldFartlek } from "./domain.js";
import { distanceMeters } from "./geometry.js";
import type { GeoBounds } from "./worldQuery.js";
import { isWithinBounds } from "./worldQuery.js";

/** Flat XP per Fartlek completion, matching the `peak` collectible tier. Never scaled by speed. */
export const FARTLEK_COMPLETION_XP = 50;

export const FARTLEK_MIN_LENGTH_METERS = 1_000;
export const FARTLEK_IDEAL_MIN_LENGTH_METERS = 2_000;
export const FARTLEK_IDEAL_MAX_LENGTH_METERS = 8_000;
export const FARTLEK_MAX_LENGTH_METERS = 15_000;

/** Total length of a LineString, in meters, using the canonical haversine distance. */
export const lineStringLengthMeters = (coordinates: [number, number][]): number => {
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const [previousLongitude, previousLatitude] = coordinates[index - 1];
    const [longitude, latitude] = coordinates[index];
    total += distanceMeters(previousLatitude, previousLongitude, latitude, longitude);
  }
  return total;
};

export const fartlekGeometryBounds = (geometry: FartlekGeometry): GeoBounds => {
  let minLatitude = Infinity;
  let maxLatitude = -Infinity;
  let minLongitude = Infinity;
  let maxLongitude = -Infinity;
  for (const [longitude, latitude] of geometry.coordinates) {
    minLatitude = Math.min(minLatitude, latitude);
    maxLatitude = Math.max(maxLatitude, latitude);
    minLongitude = Math.min(minLongitude, longitude);
    maxLongitude = Math.max(maxLongitude, longitude);
  }
  return { minLatitude, maxLatitude, minLongitude, maxLongitude };
};

/** A Fartlek is relevant to a viewport/route bbox when any of its vertices falls inside it. */
export const fartlekIntersectsBounds = (geometry: FartlekGeometry, bounds: GeoBounds): boolean =>
  geometry.coordinates.some(([longitude, latitude]) => isWithinBounds({ latitude, longitude }, bounds));

export const averageSpeedMps = (lengthMeters: number, elapsedTimeS: number): number =>
  elapsedTimeS > 0 ? lengthMeters / elapsedTimeS : 0;

export interface FartlekCompletionStats {
  completed: boolean;
  completionCount: number;
  bestElapsedTimeS?: number;
  latestCompletion?: FartlekCompletion;
}

/** Builds the World-facing projection of a Fartlek: a LineString challenge, never a point collectible. */
export const toWorldFartlek = (fartlek: Fartlek, stats: FartlekCompletionStats = { completed: false, completionCount: 0 }): WorldFartlek => ({
  id: fartlek.id,
  name: fartlek.name,
  geometry: fartlek.geometry,
  lengthMeters: fartlek.lengthMeters,
  status: fartlek.status,
  source: fartlek.source,
  completed: stats.completed,
  completionCount: stats.completionCount,
  ...(stats.bestElapsedTimeS === undefined ? {} : { bestElapsedTimeS: stats.bestElapsedTimeS }),
  ...(stats.latestCompletion === undefined ? {} : {
    latestCompletion: {
      completedAt: stats.latestCompletion.completedAt,
      elapsedTimeS: stats.latestCompletion.elapsedTimeS,
      averageSpeedMps: stats.latestCompletion.averageSpeedMps,
      ...(stats.latestCompletion.maxSpeedMps === undefined ? {} : { maxSpeedMps: stats.latestCompletion.maxSpeedMps })
    }
  })
});

/** Converts a pipeline draft (no id/playerId yet) into the shape persisted by the completion repository. */
export const draftToCompletionInput = (
  draft: FartlekCompletionDraft
): Omit<FartlekCompletion, "id" | "playerId" | "activityId" | "completedAt"> & { completedAtTimestampMs: number } => ({
  fartlekId: draft.fartlekId,
  completedAtTimestampMs: draft.completedAtTimestampMs,
  elapsedTimeS: draft.elapsedTimeS,
  averageSpeedMps: draft.averageSpeedMps,
  ...(draft.maxSpeedMps === undefined ? {} : { maxSpeedMps: draft.maxSpeedMps }),
  traversalDirection: draft.traversalDirection,
  fartlekLengthMSnapshot: draft.fartlekLengthMSnapshot,
  fartlekGeometryVersionSnapshot: draft.fartlekGeometryVersionSnapshot
});
