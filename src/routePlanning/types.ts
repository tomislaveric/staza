import type { CollectibleCategory, QuestObjective } from "../domain.js";

/** Bumped whenever candidate generation or scoring changes meaningfully; persisted with PlannedRoutes. */
export const PLANNER_VERSION = 3;

export interface LatLon {
  lat: number;
  lon: number;
}

export type RouteType = "round_trip" | "point_to_point";

export type RideConstraint =
  | { type: "distance"; meters: number }
  | { type: "duration"; seconds: number };

export interface RoutePlanningInput {
  start: LatLon;
  /** Required for point-to-point; equal to start for round trips. */
  end: LatLon;
  routeType: RouteType;
  constraint: RideConstraint;
}

/**
 * An exploration target as seen by the planner. It references an existing World object and never
 * duplicates its persistence; geometry is copied only for in-memory planning.
 */
export type QuestRouteTarget =
  | {
      kind: "point";
      id: string;
      name: string;
      objectiveIds: string[];
      category?: CollectibleCategory;
      coordinate: LatLon;
      /** Gameplay detection radius: the route must pass this close for the target to count. */
      radiusMeters: number;
      alreadyAchieved: boolean;
    }
  | {
      kind: "segment";
      id: string;
      name: string;
      objectiveIds: string[];
      /** [lon, lat] pairs, in the Flowline's canonical a→b direction. */
      coordinates: [number, number][];
      lengthMeters: number;
      bidirectional: boolean;
      alreadyAchieved: boolean;
    };

export type SegmentDirection = "forward" | "reverse";

/** One ordered stop of a candidate: a point target or a Flowline in a chosen direction. */
export interface CandidateStop {
  target: QuestRouteTarget;
  direction?: SegmentDirection;
}

export interface RouteCandidate {
  /** Deterministic signature of ordered target ids and directions. */
  key: string;
  stops: CandidateStop[];
  estimatedDistanceM: number;
  heuristicScore: number;
  strategy: "minimal" | "extended" | "reduced" | "custom";
}

export type RoutingWaypointType = "via" | "through";

export interface RoutingWaypoint extends LatLon {
  type: RoutingWaypointType;
}

/** Neutral request sent to the standalone routing service. Contains no Staza ids. */
export interface RoutingRequest {
  profile: "bicycle";
  start: LatLon;
  end: LatLon;
  waypoints: RoutingWaypoint[];
}

export interface RoutingResult {
  distanceM: number;
  durationS: number;
  elevationGainM: number | null;
  elevationLossM: number | null;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  waypoints: Array<{ index: number; type: string; snapDistanceM: number }>;
}

/** A routing request plus Staza-side correlation of waypoint indexes to target ids. */
export interface RoutingPlan {
  request: RoutingRequest;
  /** Index into the routing-service location list (0 = start) → target id. */
  waypointTargetIds: Map<number, string>;
}

export interface ObjectiveProgressPotential {
  objectiveId: string;
  type: QuestObjective["type"];
  category?: CollectibleCategory;
  included: number;
  required: number;
  /** min(included, required) / required. */
  potential: number;
}

export interface ScoreBreakdown {
  questProgress: number;
  constraintFit: number;
  loopQuality: number;
  routeShape: number;
  targetQuality: number;
  detourPenalty: number;
  total: number;
}

export interface ScoredRoute {
  candidate: RouteCandidate;
  routing: RoutingResult;
  includedTargetIds: string[];
  /** Point targets reachable within the access threshold but outside the gameplay radius. */
  nearbyTargetIds: string[];
  objectiveProgress: ObjectiveProgressPotential[];
  progressPotential: number;
  score: ScoreBreakdown;
  /** Internal target-selection strategy that produced the candidate; never shown to players. */
  strategy?: string;
}

export type ProposalLabel = "quick" | "balanced" | "adventure";

/** Composition hint shown next to the label, derived from the route's contents. */
export type ProposalHint = "flowline_rich" | "discovery" | "climb";

/** How the routed length relates to the requested ride (acceptable band = within). */
export type ConstraintFitFlag = "within" | "short" | "long";

/** Ordered stop of a stored proposal; used to keep the order when a route is customized. */
export interface ProposalStop {
  targetId: string;
  direction?: SegmentDirection;
}

export interface TargetSummary {
  flowlines: number;
  peaks: number;
  places: number;
  other: number;
}

export interface RouteProposal {
  id: string;
  label: ProposalLabel;
  hint?: ProposalHint;
  /** The planner's best-scoring proposal; the UI selects it first. */
  recommended: boolean;
  routeType: RouteType;
  distanceM: number;
  durationS: number;
  elevationGainM?: number;
  elevationLossM?: number;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  start: LatLon;
  end: LatLon;
  /** Targets the route serves for gameplay. */
  includedTargetIds: string[];
  /** Planned point targets reachable on foot from the route but outside their detection radius. */
  nearbyTargetIds: string[];
  /** Summary of included and nearby targets: the route's contents. */
  targetSummary: TargetSummary;
  constraintFit: ConstraintFitFlag;
  /** Set on routes re-planned after the player edited their targets. */
  customized?: boolean;
  /** Proposal this customized route was derived from. */
  basedOn?: string;
  /** Requested targets the customized route could not serve. */
  droppedTargetIds?: string[];
  /** Internal; useful for debugging and tests. Not intended for user display. */
  score: ScoreBreakdown;
}

/** The ephemeral server-side record behind a proposal id; never persisted to the database. */
export interface StoredProposal {
  playerId: string;
  /** Exploration session the proposal belongs to. */
  explorationId: string;
  /** Ordered planned stops, used to keep the order when the route is customized. */
  stops: ProposalStop[];
  /** Included and nearby targets of the route, used to derive the persisted objectives. */
  targets: QuestRouteTarget[];
  proposal: RouteProposal;
  plannerVersion: number;
  expiresAtMs: number;
}
