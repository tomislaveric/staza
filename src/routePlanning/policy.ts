/**
 * Planner policy: every tunable number of route planning lives here so tuning never means
 * hunting magic numbers. Future quest archetypes (Rush, Climb, Discovery, Circuit, Adventure)
 * can supply a different policy object; V1 uses the default for every quest.
 */
export interface PlannerPolicy {
  /** Score weights. Positive components are normalized to [0, 1] before weighting. */
  weights: {
    questProgress: number;
    constraintFit: number;
    /** Round trips only; for point-to-point this weight is added to routeShape. */
    loopQuality: number;
    targetQuality: number;
    routeShape: number;
    /** Subtracted. */
    detourPenalty: number;
  };
  /** |actual / requested - 1| at or below this scores a perfect fit (preferred band). */
  preferredTolerance: number;
  /** Fit tapers linearly to 0.5 at this deviation (acceptable band), then decays further. */
  acceptableTolerance: number;
  /** Deviation at which the fit score reaches 0. */
  zeroFitTolerance: number;
  /** Speed used only for pre-routing heuristics when the ride is constrained by time. */
  heuristicSpeedMps: number;
  /** Straight-line → road distance factor for estimates before routing. */
  roadFactor: number;
  /** Candidates whose estimate exceeds requested × this are pruned before routing. */
  maxEstimateRatio: number;
}

export const DEFAULT_PLANNER_POLICY: PlannerPolicy = {
  weights: {
    questProgress: 0.35,
    constraintFit: 0.25,
    loopQuality: 0.15,
    targetQuality: 0.1,
    routeShape: 0.1,
    detourPenalty: 0.05
  },
  preferredTolerance: 0.1,
  acceptableTolerance: 0.2,
  zeroFitTolerance: 0.6,
  heuristicSpeedMps: 5,
  roadFactor: 1.3,
  maxEstimateRatio: 1.6
};

/** Hard planning limits. They bound work per user action and keep the endpoint from being a routing proxy. */
export const PLANNING_LIMITS = {
  /** Routing-service calls per planning action, including unroutable-point retries. */
  maxRoutingRequests: 9,
  /** Routing-service calls when re-routing one customized proposal, including unroutable retries. */
  maxRerouteRequests: 3,
  routingConcurrency: 3,
  /** Total wall-clock budget of one planning action. */
  planningDeadlineMs: 20_000,
  maxProposals: 3,
  /** Targets one route may contain, generated or customized. */
  maxRouteTargets: 12,
  /** Route-only map points a customized route may pass through. */
  maxRouteWaypoints: 8,
  /** Eligible targets kept per objective after spatial ranking. */
  maxPoolTargetsPerObjective: 12,
  maxPoolTargets: 16,
  maxTargetsPerCandidate: 12,
  /** Bounded variants that drop the costliest targets of the fullest candidate. */
  maxReducedVariants: 2,
  /** Seeds tried per strategy during candidate generation. */
  maxSeeds: 6,
  maxDistanceMeters: 300_000,
  minDistanceMeters: 2_000,
  maxDurationSeconds: 12 * 3600,
  minDurationSeconds: 10 * 60,
  /** Start/end must lie within this distance of at least one exploration target. */
  maxStartToTargetMeters: 150_000,
  proposalTtlMs: 30 * 60_000,
  /** Global cap on in-memory proposals across all players. */
  maxStoredProposals: 2_000,
  /** Generated plus customized proposals kept per player. */
  maxStoredProposalsPerPlayer: 30
} as const;

/** Proposal selection and labelling thresholds. */
export const PROPOSAL_SELECTION = {
  /** Two proposals are distinct when their target sets overlap less than this (Jaccard)… */
  maxTargetOverlap: 0.6,
  /** …or their distances differ by more than this share. */
  minDistanceDifference: 0.15,
  /** "Quick" must be at most this share of the Adventure distance. */
  quickDistanceRatio: 0.85,
  /** Share of a route's destinations of one kind that earns a composition hint. */
  hintShare: 0.6,
  /** Elevation gain per km that earns the "Climb" hint. */
  climbMetersPerKm: 15
} as const;

/** Route-geometry validation thresholds. */
export const VALIDATION = {
  /**
   * Point targets (notably Peaks) may sit off the road network. A route passing within this
   * distance is "nearby" (reachable on foot); farther means the target is not served. Matches
   * the routing service's default SNAP_TOLERANCE_M so behaviour is consistent across the boundary.
   */
  maxPointAccessMeters: 500,
  /** Flowline samples within this corridor of the route count as traversed. */
  flowlineCorridorMeters: 30,
  /** Minimum share of a Flowline the route must ride for it to count as traversed. */
  minFlowlineCoverage: 0.8,
  flowlineSampleSpacingMeters: 25,
  /** Route sampling used for loop and backtracking metrics. */
  routeSampleSpacingMeters: 50,
  retraceCorridorMeters: 25,
  /** Samples closer than this along the route are neighbours, not retracing. */
  retraceMinSeparationMeters: 300,
  /** Isoperimetric quotient treated as a "perfect" real-road loop. */
  loopCompactnessTarget: 0.5,
  /** Routed / estimated distance ratio above which the detour penalty starts. */
  detourFreeRatio: 1.5,
  /** Additional ratio over which the detour penalty grows from 0 to 1. */
  detourPenaltySpan: 1.5
} as const;
