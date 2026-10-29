import { PolylineIndex, sampleAlong } from "./geo.js";
import { VALIDATION } from "./policy.js";
import type { GeoBounds } from "../worldQuery.js";
import type { FlowlineGeometry, QuestRouteTarget, RoutingResult, TraversedFlowline } from "./types.js";

export interface RouteValidation {
  /** Destinations the route actually serves for gameplay (inside the detection radius). */
  includedTargetIds: string[];
  /** Destinations reachable within the access threshold but outside the detection radius. */
  nearbyTargetIds: string[];
}

/** Share of the Flowline's samples that lie within the corridor of the routed geometry. */
export const flowlineCoverage = (index: PolylineIndex, flowline: FlowlineGeometry): number => {
  const samples = sampleAlong(flowline.coordinates, VALIDATION.flowlineSampleSpacingMeters);
  if (samples.length === 0) return 0;
  const covered = samples.filter((sample) => index.nearest(sample, VALIDATION.flowlineCorridorMeters) !== undefined).length;
  return covered / samples.length;
};

/**
 * Flowlines the routed geometry naturally rides: derived metadata only. Flowlines never shape
 * or constrain routing, and this never decides gameplay completion (that depends on the
 * imported activity).
 */
export const traversedFlowlines = (routing: Pick<RoutingResult, "geometry">, flowlines: FlowlineGeometry[]): TraversedFlowline[] => {
  if (flowlines.length === 0 || routing.geometry.coordinates.length < 2) return [];
  const index = new PolylineIndex(routing.geometry.coordinates);
  return flowlines
    .filter((flowline) => {
      // Cheap pre-check before sampling the whole Flowline.
      const midpoint = flowline.coordinates[Math.floor(flowline.coordinates.length / 2)];
      if (!index.nearest(midpoint, VALIDATION.flowlineCorridorMeters * 4)) return false;
      return flowlineCoverage(index, flowline) >= VALIDATION.minFlowlineCoverage;
    })
    .map(({ id, name, lengthMeters }) => ({ id, name, lengthMeters }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
};

/** Checks the routed geometry against every eligible destination; point targets count inside their radius. */
export const validateRoute = (routing: RoutingResult, eligibleTargets: QuestRouteTarget[]): RouteValidation => {
  const index = new PolylineIndex(routing.geometry.coordinates);
  const included: string[] = [];
  const nearby: string[] = [];
  for (const target of eligibleTargets) {
    const hit = index.nearest([target.coordinate.lon, target.coordinate.lat], VALIDATION.maxPointAccessMeters);
    if (!hit) continue;
    if (hit.distance <= target.radiusMeters) included.push(target.id);
    else nearby.push(target.id);
  }
  return { includedTargetIds: included, nearbyTargetIds: nearby };
};

/** Slack for router snapping noise at the area edge (~11 m). */
const BOUNDS_TOLERANCE_DEGREES = 0.0001;

export const insideBounds = ([lon, lat]: [number, number], bounds: GeoBounds, tolerance = BOUNDS_TOLERANCE_DEGREES): boolean =>
  lat >= bounds.minLatitude - tolerance && lat <= bounds.maxLatitude + tolerance
  && lon >= bounds.minLongitude - tolerance && lon <= bounds.maxLongitude + tolerance;

/**
 * Whether the routed geometry stays inside the frozen area. A start outside the area may be joined
 * by a connector: the leading part before the route first enters the area and, for round trips,
 * the trailing return part after it last leaves. Every other point must lie inside.
 */
export const staysWithinBounds = (
  coordinates: [number, number][],
  bounds: GeoBounds,
  { startOutside, roundTrip }: { startOutside: boolean; roundTrip: boolean }
): boolean => {
  const inside = coordinates.map((point) => insideBounds(point, bounds));
  if (!startOutside) return inside.every(Boolean);
  const first = inside.indexOf(true);
  if (first < 0) return false;
  const last = roundTrip ? inside.lastIndexOf(true) : inside.length - 1;
  return inside.slice(first, last + 1).every(Boolean);
};
