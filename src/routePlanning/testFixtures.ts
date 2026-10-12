import type { QuestObjective } from "../domain.js";
import { lineLengthMeters, type LonLat } from "./geo.js";
import type { LatLon, QuestRouteTarget, RoutingRequest, RoutingResult } from "./types.js";

/** Shared synthetic world used by route-planning tests. Not imported by production code. */
export const ORIGIN: LatLon = { lat: 46.0, lon: 15.0 };
const METERS_PER_DEGREE = 111_195;

export const at = (northKm: number, eastKm: number): LatLon => ({
  lat: ORIGIN.lat + (northKm * 1000) / METERS_PER_DEGREE,
  lon: ORIGIN.lon + (eastKm * 1000) / (METERS_PER_DEGREE * Math.cos((ORIGIN.lat * Math.PI) / 180))
});

const lonLat = (point: LatLon): LonLat => [point.lon, point.lat];

export const pointTarget = (
  id: string,
  objectiveId: string,
  northKm: number,
  eastKm: number,
  options: { category?: "peak" | "place" | "viewpoint"; alreadyAchieved?: boolean } = {}
): QuestRouteTarget => ({
  kind: "point",
  id,
  name: id,
  objectiveIds: [objectiveId],
  category: options.category ?? "place",
  coordinate: at(northKm, eastKm),
  radiusMeters: 100,
  alreadyAchieved: options.alreadyAchieved ?? false
});

export const segmentTarget = (
  id: string,
  objectiveId: string,
  from: [number, number],
  to: [number, number],
  options: { alreadyAchieved?: boolean; bidirectional?: boolean } = {}
): QuestRouteTarget => {
  const coordinates = Array.from({ length: 6 }, (_value, index) => {
    const t = index / 5;
    return lonLat(at(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t));
  });
  return {
    kind: "segment",
    id,
    name: id,
    objectiveIds: [objectiveId],
    coordinates,
    lengthMeters: lineLengthMeters(coordinates),
    bidirectional: options.bidirectional ?? true,
    alreadyAchieved: options.alreadyAchieved ?? false
  };
};

export const objectivesFor = (targets: QuestRouteTarget[], required: Record<string, number>): QuestObjective[] =>
  Object.entries(required).map(([objectiveId, requiredCount]) => {
    const objectiveTargets = targets
      .filter((target) => target.objectiveIds.includes(objectiveId))
      .map((target) => ({ id: target.id, name: target.name }));
    const isFlowline = targets.some((target) => target.objectiveIds.includes(objectiveId) && target.kind === "segment");
    return isFlowline
      ? { id: objectiveId, type: "flowline_rule", requiredCount, targets: objectiveTargets }
      : { id: objectiveId, type: "collectible_targets", requiredCount, targets: objectiveTargets };
  });

const densify = (points: LonLat[], stepMeters = 50): LonLat[] => {
  const result: LonLat[] = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const [lonA, latA] = points[index - 1];
    const [lonB, latB] = points[index];
    const steps = Math.max(1, Math.ceil(lineLengthMeters([points[index - 1], points[index]]) / stepMeters));
    for (let step = 1; step <= steps; step += 1) {
      result.push([lonA + ((lonB - lonA) * step) / steps, latA + ((latB - latA) * step) / steps]);
    }
  }
  return result;
};

/** Straight-line "router": rides directly through every requested location. */
export const straightLineRoute = (request: RoutingRequest, detourFactor = 1): RoutingResult => {
  const locations = [request.start, ...request.waypoints, request.end];
  const coordinates = densify(locations.map(lonLat));
  const distanceM = lineLengthMeters(coordinates) * detourFactor;
  return {
    distanceM,
    durationS: distanceM / 6,
    elevationGainM: 100,
    elevationLossM: 100,
    geometry: { type: "LineString", coordinates },
    waypoints: locations.map((_location, index) => ({ index, type: "via", snapDistanceM: 0 }))
  };
};
