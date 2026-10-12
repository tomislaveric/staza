import { PolylineIndex, sampleAlong } from "./geo.js";
import { VALIDATION } from "./policy.js";
import type { RouteCandidate, QuestRouteTarget, RoutingResult } from "./types.js";

export interface RouteValidation {
  /** False when a planned Flowline was bypassed or ridden against a restricted direction. */
  valid: boolean;
  reason?: "flowline_bypassed" | "flowline_wrong_direction";
  /** Targets the route actually serves for gameplay (inside detection radius / sufficiently covered). */
  includedTargetIds: string[];
  /** Point targets reachable within the access threshold but outside the detection radius. */
  nearbyTargetIds: string[];
}

export const flowlineCoverage = (index: PolylineIndex, target: Extract<QuestRouteTarget, { kind: "segment" }>): {
  coverage: number;
  forward: boolean;
} => {
  const samples = sampleAlong(target.coordinates, VALIDATION.flowlineSampleSpacingMeters);
  const hits = samples.map((sample) => index.nearest(sample, VALIDATION.flowlineCorridorMeters));
  const covered = hits.filter((hit) => hit !== undefined).length;
  const first = hits.find((hit) => hit !== undefined);
  const last = [...hits].reverse().find((hit) => hit !== undefined);
  return {
    coverage: samples.length > 0 ? covered / samples.length : 0,
    forward: first !== undefined && last !== undefined ? last.along >= first.along : true
  };
};

/**
 * Checks the routed geometry against every eligible target. Planned Flowlines must be covered,
 * otherwise the candidate is rejected; point targets count only inside their gameplay radius.
 * Unplanned targets the route happens to serve are credited too, because gameplay would count them.
 */
export const validateRoute = (candidate: RouteCandidate, routing: RoutingResult, eligibleTargets: QuestRouteTarget[]): RouteValidation => {
  const index = new PolylineIndex(routing.geometry.coordinates);
  const planned = new Set(candidate.stops.map((stop) => stop.target.id));
  const included: string[] = [];
  const nearby: string[] = [];

  for (const target of eligibleTargets) {
    if (target.kind === "point") {
      const hit = index.nearest([target.coordinate.lon, target.coordinate.lat], VALIDATION.maxPointAccessMeters);
      if (!hit) continue;
      if (hit.distance <= target.radiusMeters) included.push(target.id);
      else nearby.push(target.id);
      continue;
    }
    const isPlanned = planned.has(target.id);
    if (!isPlanned) {
      // Cheap pre-check before sampling an unplanned Flowline.
      const midpoint = target.coordinates[Math.floor(target.coordinates.length / 2)];
      if (!index.nearest(midpoint, VALIDATION.flowlineCorridorMeters * 4)) continue;
    }
    const { coverage, forward } = flowlineCoverage(index, target);
    const covered = coverage >= VALIDATION.minFlowlineCoverage;
    if (isPlanned && !covered) {
      return { valid: false, reason: "flowline_bypassed", includedTargetIds: [], nearbyTargetIds: [] };
    }
    if (covered && !target.bidirectional && !forward) {
      if (isPlanned) return { valid: false, reason: "flowline_wrong_direction", includedTargetIds: [], nearbyTargetIds: [] };
      continue;
    }
    if (covered) included.push(target.id);
  }
  return { valid: true, includedTargetIds: included, nearbyTargetIds: nearby };
};
