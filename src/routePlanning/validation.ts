import { PolylineIndex, sampleAlong } from "./geo.js";
import { VALIDATION } from "./policy.js";
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
