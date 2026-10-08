import type { Fartlek, FartlekCompletionDraft, FartlekTraversalDirection, TrackPoint } from "./domain.js";
import { distanceMeters } from "./geometry.js";
import { lineStringLengthMeters } from "./fartlek.js";

/** Wider than typical consumer GPS error, narrower than typical road-to-road spacing. */
export const CORRIDOR_BUFFER_METERS = 22;
/** Width of the perpendicular start/end gates, analogous to detectCollectiblePassage's crossing. */
export const GATE_WIDTH_METERS = 15;
/** Fraction of the segment's arc length that must be covered, in order, to count as traversed. */
export const MIN_COVERAGE_RATIO = 0.95;
/** Fixed distance step used to resample the activity route before projection. */
export const RESAMPLE_STEP_METERS = 10;
/** Small allowed backtrack before a run is considered to have reversed direction. */
export const BACKTRACK_TOLERANCE_METERS = 30;
/** Bin size used to measure ordered arc-length coverage. */
export const COVERAGE_BIN_METERS = 50;

const EARTH_RADIUS_M = 6_371_000;
const RADIANS = Math.PI / 180;

interface LocalPoint {
  x: number;
  y: number;
}

interface ResampledPoint extends LocalPoint {
  timestampMs: number;
}

/** Equirectangular projection local to one origin; adequate for segments well under ~15 km. */
const makeProjector = (origin: { latitude: number; longitude: number }) => {
  const scale = Math.cos(origin.latitude * RADIANS);
  return (point: { latitude: number; longitude: number }): LocalPoint => ({
    x: (point.longitude - origin.longitude) * RADIANS * EARTH_RADIUS_M * scale,
    y: (point.latitude - origin.latitude) * RADIANS * EARTH_RADIUS_M
  });
};

/** Resamples a route at a fixed distance step so detection is uniform regardless of source sampling rate. */
export const resampleRoute = (route: TrackPoint[], stepMeters: number): TrackPoint[] => {
  if (route.length === 0) return [];
  const resampled: TrackPoint[] = [route[0]];
  let residual = 0;
  for (let index = 1; index < route.length; index += 1) {
    const before = route[index - 1];
    const after = route[index];
    const segmentLength = distanceMeters(before.latitude, before.longitude, after.latitude, after.longitude);
    if (segmentLength === 0) continue;
    let covered = 0;
    while (residual + (segmentLength - covered) >= stepMeters) {
      const remaining = stepMeters - residual;
      covered += remaining;
      residual = 0;
      const fraction = covered / segmentLength;
      resampled.push({
        latitude: before.latitude + (after.latitude - before.latitude) * fraction,
        longitude: before.longitude + (after.longitude - before.longitude) * fraction,
        timestampMs: before.timestampMs + (after.timestampMs - before.timestampMs) * fraction
      });
    }
    residual += segmentLength - covered;
  }
  const last = route[route.length - 1];
  if (resampled[resampled.length - 1] !== last) resampled.push(last);
  return resampled;
};

interface PolylineProjection {
  verticesLocal: LocalPoint[];
  cumulativeLengths: number[];
  totalLength: number;
}

const buildPolylineProjection = (
  coordinates: [number, number][],
  projector: ReturnType<typeof makeProjector>
): PolylineProjection => {
  const verticesLocal = coordinates.map(([longitude, latitude]) => projector({ latitude, longitude }));
  const cumulativeLengths = [0];
  for (let index = 1; index < coordinates.length; index += 1) {
    const [previousLongitude, previousLatitude] = coordinates[index - 1];
    const [longitude, latitude] = coordinates[index];
    cumulativeLengths.push(
      cumulativeLengths[index - 1] + distanceMeters(previousLatitude, previousLongitude, latitude, longitude)
    );
  }
  return { verticesLocal, cumulativeLengths, totalLength: cumulativeLengths[cumulativeLengths.length - 1] };
};

/** The closest point on the polyline to `target`: its perpendicular distance and arc-length position. */
const closestOnPolyline = (
  target: LocalPoint,
  projection: PolylineProjection
): { distanceMeters: number; arcLengthMeters: number } => {
  let best = { distanceMeters: Infinity, arcLengthMeters: 0 };
  const { verticesLocal, cumulativeLengths } = projection;
  for (let index = 0; index < verticesLocal.length - 1; index += 1) {
    const start = verticesLocal[index];
    const end = verticesLocal[index + 1];
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const lengthSquared = deltaX ** 2 + deltaY ** 2;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
      ((target.x - start.x) * deltaX + (target.y - start.y) * deltaY) / lengthSquared));
    const closestX = start.x + deltaX * t;
    const closestY = start.y + deltaY * t;
    const distance = Math.hypot(target.x - closestX, target.y - closestY);
    if (distance < best.distanceMeters) {
      const segmentLength = cumulativeLengths[index + 1] - cumulativeLengths[index];
      best = { distanceMeters: distance, arcLengthMeters: cumulativeLengths[index] + segmentLength * t };
    }
  }
  return best;
};

interface CorridorSample {
  arcLengthMeters: number;
  timestampMs: number;
  speedMps?: number;
}

/** Groups consecutive in-corridor samples into runs, breaking on direction reversal beyond tolerance. */
const buildRuns = (samples: CorridorSample[]): CorridorSample[][] => {
  const runs: CorridorSample[][] = [];
  let current: CorridorSample[] = [];
  let direction: 1 | -1 | 0 = 0;
  let extreme = 0;
  for (const sample of samples) {
    if (current.length === 0) {
      current.push(sample);
      extreme = sample.arcLengthMeters;
      continue;
    }
    const previous = current[current.length - 1];
    const delta = sample.arcLengthMeters - previous.arcLengthMeters;
    if (direction === 0 && delta !== 0) direction = delta > 0 ? 1 : -1;
    extreme = direction === 1 ? Math.max(extreme, sample.arcLengthMeters) : Math.min(extreme, sample.arcLengthMeters);
    const backtrack = direction === 1 ? extreme - sample.arcLengthMeters : sample.arcLengthMeters - extreme;
    if (direction !== 0 && backtrack > BACKTRACK_TOLERANCE_METERS) {
      runs.push(current);
      current = [sample];
      direction = 0;
      extreme = sample.arcLengthMeters;
      continue;
    }
    current.push(sample);
  }
  if (current.length > 0) runs.push(current);
  return runs;
};

const coverageRatio = (run: CorridorSample[], totalLength: number, direction: FartlekTraversalDirection): number => {
  const binCount = Math.max(1, Math.ceil(totalLength / COVERAGE_BIN_METERS));
  const covered = new Array<boolean>(binCount).fill(false);
  let extreme = direction === "a_to_b" ? -Infinity : Infinity;
  for (const sample of run) {
    // Only count progress that is part of the ordered (non-backtracked) advance.
    const advanced = direction === "a_to_b" ? sample.arcLengthMeters >= extreme - BACKTRACK_TOLERANCE_METERS
      : sample.arcLengthMeters <= extreme + BACKTRACK_TOLERANCE_METERS;
    if (!advanced) continue;
    extreme = direction === "a_to_b" ? Math.max(extreme, sample.arcLengthMeters) : Math.min(extreme, sample.arcLengthMeters);
    const bin = Math.min(binCount - 1, Math.max(0, Math.floor(sample.arcLengthMeters / COVERAGE_BIN_METERS)));
    covered[bin] = true;
  }
  return covered.filter(Boolean).length / binCount;
};

export interface FartlekTraversalResult {
  completed: boolean;
  direction?: FartlekTraversalDirection;
  completedAtTimestampMs?: number;
  elapsedTimeS?: number;
  averageSpeedMps?: number;
  maxSpeedMps?: number;
}

/**
 * Detects whether an activity traverses a Fartlek's full segment: a buffered corridor around the
 * LineString, start/end gates, monotonic in-order progression from one gate to the other (small
 * backtrack tolerated), and >=95% ordered arc-length coverage. Never gated by speed.
 */
export const detectFartlekTraversal = (
  route: TrackPoint[],
  fartlek: Pick<Fartlek, "geometry" | "lengthMeters">
): FartlekTraversalResult => {
  const coordinates = fartlek.geometry.coordinates;
  if (coordinates.length < 2 || route.length < 2) return { completed: false };
  const origin = { latitude: coordinates[0][1], longitude: coordinates[0][0] };
  const projector = makeProjector(origin);
  const projection = buildPolylineProjection(coordinates, projector);
  const totalLength = projection.totalLength;
  if (totalLength <= 0) return { completed: false };

  const resampled = resampleRoute(route, RESAMPLE_STEP_METERS);
  const samples: CorridorSample[] = [];
  for (let index = 0; index < resampled.length; index += 1) {
    const point = resampled[index];
    const local = projector(point);
    const { distanceMeters: perpendicular, arcLengthMeters } = closestOnPolyline(local, projection);
    if (perpendicular > CORRIDOR_BUFFER_METERS) continue;
    let speedMps: number | undefined;
    if (index > 0) {
      const previous = resampled[index - 1];
      const dtS = (point.timestampMs - previous.timestampMs) / 1000;
      if (dtS > 0) {
        const metersMoved = distanceMeters(previous.latitude, previous.longitude, point.latitude, point.longitude);
        speedMps = metersMoved / dtS;
      }
    }
    samples.push({ arcLengthMeters, timestampMs: point.timestampMs, ...(speedMps === undefined ? {} : { speedMps }) });
  }
  if (samples.length === 0) return { completed: false };

  const gate = GATE_WIDTH_METERS / 2;
  for (const run of buildRuns(samples)) {
    if (run.length < 2) continue;
    const first = run[0];
    const last = run[run.length - 1];
    const direction: FartlekTraversalDirection = last.arcLengthMeters >= first.arcLengthMeters ? "a_to_b" : "b_to_a";
    const reachesStartGate = direction === "a_to_b" ? first.arcLengthMeters <= gate : last.arcLengthMeters <= gate;
    const reachesEndGate = direction === "a_to_b"
      ? last.arcLengthMeters >= totalLength - gate
      : first.arcLengthMeters >= totalLength - gate;
    if (!reachesStartGate || !reachesEndGate) continue;
    if (coverageRatio(run, totalLength, direction) < MIN_COVERAGE_RATIO) continue;

    const elapsedTimeS = (last.timestampMs - first.timestampMs) / 1000;
    if (elapsedTimeS <= 0) continue;
    const speeds = run.map((sample) => sample.speedMps).filter((speed): speed is number => speed !== undefined && speed > 0);
    return {
      completed: true,
      direction,
      completedAtTimestampMs: last.timestampMs,
      elapsedTimeS,
      averageSpeedMps: fartlek.lengthMeters / elapsedTimeS,
      ...(speeds.length > 0 ? { maxSpeedMps: Math.max(...speeds) } : {})
    };
  }
  return { completed: false };
};

/**
 * Derives at most one completion draft per Fartlek for one activity, independent of how many
 * times the segment was traversed within it ("one activity creates at most one completion").
 */
export const deriveFartlekCompletionDrafts = (
  route: TrackPoint[],
  fartleks: Fartlek[]
): FartlekCompletionDraft[] => {
  const drafts: FartlekCompletionDraft[] = [];
  for (const fartlek of fartleks) {
    if (fartlek.status !== "published") continue;
    const result = detectFartlekTraversal(route, fartlek);
    if (!result.completed || result.direction === undefined ||
      result.completedAtTimestampMs === undefined || result.elapsedTimeS === undefined ||
      result.averageSpeedMps === undefined) continue;
    drafts.push({
      fartlekId: fartlek.id,
      fartlekName: fartlek.name,
      fartlekGeometry: fartlek.geometry,
      completedAtTimestampMs: result.completedAtTimestampMs,
      elapsedTimeS: result.elapsedTimeS,
      averageSpeedMps: result.averageSpeedMps,
      ...(result.maxSpeedMps === undefined ? {} : { maxSpeedMps: result.maxSpeedMps }),
      traversalDirection: result.direction,
      fartlekLengthMSnapshot: fartlek.lengthMeters,
      fartlekGeometryVersionSnapshot: fartlek.geometryVersion
    });
  }
  return drafts;
};

/** Re-exported for callers that only need the plain geometry length (e.g. OSM candidate generation). */
export { lineStringLengthMeters };
