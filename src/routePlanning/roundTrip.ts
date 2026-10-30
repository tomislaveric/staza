import { distanceBetween, sampleAlong } from "./geo.js";
import type { LatLon, RoutingResult } from "./types.js";

/**
 * Makes a round-trip route visibly end where it started. Routers snap the start to the road
 * network, so the geometry may stop short of the start; a closing leg is appended and its
 * length (at the route's own average pace) is added to distance and duration.
 */
export const closeRoundTrip = (result: RoutingResult, start: LatLon): RoutingResult => {
  const coordinates = result.geometry.coordinates;
  const [lastLon, lastLat] = coordinates[coordinates.length - 1];
  if (lastLon === start.lon && lastLat === start.lat) return result;
  const gapM = distanceBetween({ lat: lastLat, lon: lastLon }, start);
  const paceSPerM = result.distanceM > 0 ? result.durationS / result.distanceM : 0;
  return {
    ...result,
    distanceM: result.distanceM + gapM,
    durationS: result.durationS + gapM * paceSPerM,
    geometry: { type: "LineString", coordinates: [...coordinates, [start.lon, start.lat]] }
  };
};

const BACKTRACK_SPACING_M = 50;
const BACKTRACK_CELL_DEG = 0.0006;
/** Samples this close in sequence are the same pass, not a return along the road. */
const BACKTRACK_MIN_GAP = 12;

/** Share of a route (0-1) that retraces road it already rode, e.g. an out-and-back. */
export const backtrackRatio = (coordinates: [number, number][]): number => {
  const samples = sampleAlong(coordinates, BACKTRACK_SPACING_M);
  if (samples.length <= BACKTRACK_MIN_GAP) return 0;
  const cell = (value: number) => Math.round(value / BACKTRACK_CELL_DEG);
  const visited = new Map<string, number>();
  let repeated = 0;
  samples.forEach(([lon, lat], index) => {
    const x = cell(lon);
    const y = cell(lat);
    let seenBefore = false;
    for (let dx = -1; dx <= 1 && !seenBefore; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const first = visited.get(`${x + dx},${y + dy}`);
        if (first !== undefined && index - first >= BACKTRACK_MIN_GAP) {
          seenBefore = true;
          break;
        }
      }
    }
    if (seenBefore) repeated += 1;
    if (!visited.has(`${x},${y}`)) visited.set(`${x},${y}`, index);
  });
  return repeated / samples.length;
};

/** A sample this close to an earlier, nearby-in-sequence sample is a spur or zigzag, not a switchback. */
const DETOUR_RETURN_M = 30;
const DETOUR_MIN_GAP = 4;

/**
 * Length in metres of a route spent on short local detours: it leaves a road and comes back to it
 * within a few hundred metres. Longer retracing is measured by `backtrackRatio`.
 */
export const detourLengthM = (coordinates: [number, number][]): number => {
  const samples = sampleAlong(coordinates, BACKTRACK_SPACING_M);
  if (samples.length <= DETOUR_MIN_GAP) return 0;
  const points = samples.map(([lon, lat]) => ({ lat, lon }));
  let detoured = 0;
  for (let index = DETOUR_MIN_GAP; index < points.length; index += 1) {
    for (let earlier = Math.max(0, index - BACKTRACK_MIN_GAP + 1); earlier <= index - DETOUR_MIN_GAP; earlier += 1) {
      if (distanceBetween(points[index], points[earlier]) <= DETOUR_RETURN_M) {
        detoured += 1;
        break;
      }
    }
  }
  return detoured * BACKTRACK_SPACING_M;
};
