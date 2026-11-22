/**
 * Route intents for "Generate route": what the player wants the ride to feel like. Every tunable
 * lives here as a named constant so tuning never means hunting magic numbers in the generator.
 *
 * - Flow: Flowline quality first, few interruptions, POIs only when (almost) free.
 * - Chill: balanced route quality, lower complexity, moderate length, POIs optional.
 * - Explore: a few good, varied POIs and small detours — never at the cost of route quality.
 *
 * Intents never mean speed: Staza does not optimize how fast a route can be ridden.
 */
import { UserInputError } from "../errors.js";
import { lineLengthMeters, sampleAlong, type LonLat } from "./geo.js";
import { PLANNING_LIMITS } from "./policy.js";
import { RIDE_STYLE_POLICIES, styleFit, type RideStyle } from "./rideStyle.js";
import { backtrackRatio, detourLengthM } from "./roundTrip.js";
import type { FlowlineGeometry, QuestRouteTarget, RouteType, ScoredRoute } from "./types.js";
import { traversedFlowlines } from "./validation.js";

export type RouteIntent = "flow" | "chill" | "explore";

export const ROUTE_INTENTS: readonly RouteIntent[] = ["flow", "chill", "explore"];

/** Older clients send no intent; they get the calm default. */
export const DEFAULT_ROUTE_INTENT: RouteIntent = "chill";

export interface RouteIntentWeights {
  /** Loop shape, no retracing, no local spurs. */
  routeQuality: number;
  /** Share of the route on Flowlines that fit the intent. */
  flowlineQuality: number;
  /** Few sharp turns, stops and Flowline hops (higher is calmer). */
  interruptions: number;
  /** Routed length against the intent's length. */
  distanceFit: number;
  /** Points of interest with diminishing returns per category and a variety bonus. */
  poiValue: number;
}

export interface RouteIntentPolicy {
  intent: RouteIntent;
  /** Share of the area-derived ride length this intent aims for. */
  lengthFactor: number;
  /** Hard cap on the aimed ride length. */
  maxLengthMeters: number;
  flowlines: {
    /** Ride style whose weights rank Flowlines for this intent. */
    style: RideStyle;
    /** Flowlines chained into the route skeleton at most. */
    max: number;
    /** Flowlines whose style fit (0..1) is below this are never used as skeleton. */
    minFit: number;
  };
  pois: {
    /** Collectibles the generator plans in at most; free ones the route passes still count. */
    max: number;
    /** Estimated extra length one planned collectible may add to the route. */
    maxDetourMeters: number;
  };
  /** Routes below this route quality (0..1) are only returned when nothing better exists. */
  qualityFloor: number;
  /** A route with planned collectibles may lose at most this much quality against its skeleton. */
  maxQualityDrop: number;
  weights: RouteIntentWeights;
}

export const ROUTE_INTENT_POLICIES: Record<RouteIntent, RouteIntentPolicy> = {
  flow: {
    intent: "flow",
    lengthFactor: 1,
    maxLengthMeters: 120_000,
    flowlines: { style: "flow", max: 3, minFit: 0.45 },
    pois: { max: 1, maxDetourMeters: 400 },
    qualityFloor: 0.6,
    maxQualityDrop: 0.03,
    weights: { routeQuality: 0.25, flowlineQuality: 0.4, interruptions: 0.2, distanceFit: 0.1, poiValue: 0.05 }
  },
  chill: {
    intent: "chill",
    lengthFactor: 0.6,
    maxLengthMeters: 50_000,
    flowlines: { style: "balanced", max: 1, minFit: 0.4 },
    pois: { max: 2, maxDetourMeters: 1_200 },
    qualityFloor: 0.55,
    maxQualityDrop: 0.05,
    weights: { routeQuality: 0.35, flowlineQuality: 0.15, interruptions: 0.2, distanceFit: 0.2, poiValue: 0.1 }
  },
  explore: {
    intent: "explore",
    lengthFactor: 1,
    maxLengthMeters: 120_000,
    flowlines: { style: "explore", max: 2, minFit: 0.35 },
    pois: { max: 4, maxDetourMeters: 2_500 },
    qualityFloor: 0.5,
    maxQualityDrop: 0.1,
    weights: { routeQuality: 0.3, flowlineQuality: 0.15, interruptions: 0.1, distanceFit: 0.15, poiValue: 0.3 }
  }
};

export const routeIntentPolicy = (intent: RouteIntent = DEFAULT_ROUTE_INTENT): RouteIntentPolicy => ROUTE_INTENT_POLICIES[intent];

export const parseRouteIntent = (value: unknown): RouteIntent => {
  if (value === undefined || value === null) return DEFAULT_ROUTE_INTENT;
  if (typeof value === "string" && (ROUTE_INTENTS as readonly string[]).includes(value)) return value as RouteIntent;
  throw new UserInputError("Intent must be flow, chill or explore.");
};

/** The area-derived ride length, scaled and capped for the intent. */
export const intentLengthMeters = (areaMeters: number, intent: RouteIntent): number => {
  const policy = routeIntentPolicy(intent);
  return Math.round(Math.max(PLANNING_LIMITS.minDistanceMeters, Math.min(policy.maxLengthMeters, areaMeters * policy.lengthFactor)));
};

/** Scoring constants shared by every intent. */
export const INTENT_SCORING = {
  /** Backtracking share that costs the whole route quality. */
  maxBacktrack: 0.5,
  /** Local spur length that costs the whole route quality. */
  detourPenaltyMeters: 1_000,
  /** Route sampling for the interruption proxy. */
  turnSampleMeters: 100,
  /** Heading change that counts as a sharp turn. */
  sharpTurnDegrees: 60,
  /** Interruptions per km (turns, stops, Flowline hops) at which the calm score reaches 0. */
  maxInterruptionsPerKm: 1.5,
  /** Share of the route on well-fitting Flowlines that scores full Flowline quality. */
  flowlineShareTarget: 0.5,
  /** Style fit assumed for Flowlines without scores. */
  unscoredFlowlineFit: 0.5,
  /** Completed Flowlines are good riding but no longer an opportunity. */
  completedFlowlineFactor: 0.7,
  /** Value of a collectible the player already found. */
  achievedPoiValue: 0.3,
  /** Each further collectible of the same category is worth this share of the previous one. */
  sameCategoryDecay: 0.4,
  /** Bonus for each additional category a route visits. */
  varietyBonus: 0.3
} as const;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** A Flowline's fit (0..1) for the intent, from its 0..100 style scores. */
export const flowlineFit = (flowline: FlowlineGeometry, intent: RouteIntent): number => {
  const { scores } = flowline;
  const fit = scores
    ? styleFit(RIDE_STYLE_POLICIES[routeIntentPolicy(intent).flowlines.style], scores) / 100
    : INTENT_SCORING.unscoredFlowlineFit;
  return clamp01(fit) * (flowline.completed ? INTENT_SCORING.completedFlowlineFactor : 1);
};

/** Route quality (0..1): loop shape and no retracing, minus backtracking and local spurs. */
export const routeQuality = (route: ScoredRoute, routeType: RouteType): number => {
  const coordinates = route.routing.geometry.coordinates;
  const shape = routeType === "round_trip" ? route.score.loopQuality : route.score.routeShape;
  return clamp01(shape
    - backtrackRatio(coordinates) / INTENT_SCORING.maxBacktrack * 0.5
    - detourLengthM(coordinates) / INTENT_SCORING.detourPenaltyMeters * 0.5);
};

const headingDegrees = ([lonA, latA]: LonLat, [lonB, latB]: LonLat): number => {
  const scale = Math.cos((((latA + latB) / 2) * Math.PI) / 180);
  return (Math.atan2(latB - latA, (lonB - lonA) * scale) * 180) / Math.PI;
};

/** Sharp heading changes along the route, sampled at a fixed spacing. */
export const sharpTurns = (coordinates: LonLat[]): number => {
  const samples = sampleAlong(coordinates, INTENT_SCORING.turnSampleMeters);
  let turns = 0;
  for (let index = 2; index < samples.length; index += 1) {
    const before = headingDegrees(samples[index - 2], samples[index - 1]);
    const after = headingDegrees(samples[index - 1], samples[index]);
    const change = Math.abs(((after - before + 540) % 360) - 180);
    if (change >= INTENT_SCORING.sharpTurnDegrees) turns += 1;
  }
  return turns;
};

/**
 * Calmness (0..1, higher = fewer interruptions). Staza has no traffic-signal or junction data, so
 * this is a geometry proxy: sharp turns, planned stops and hops between Flowlines per km.
 */
export const interruptionScore = (route: ScoredRoute, ridden: number): number => {
  const km = Math.max(1, lineLengthMeters(route.routing.geometry.coordinates) / 1000);
  const interruptions = sharpTurns(route.routing.geometry.coordinates) + route.candidate.stops.length + Math.max(0, ridden - 1);
  return clamp01(1 - interruptions / km / INTENT_SCORING.maxInterruptionsPerKm);
};

/** Share of the route on Flowlines, weighted by how well each fits the intent. */
export const flowlineQuality = (route: ScoredRoute, flowlines: FlowlineGeometry[], intent: RouteIntent): { score: number; ridden: number } => {
  const byId = new Map(flowlines.map((flowline) => [flowline.id, flowline]));
  const ridden = traversedFlowlines(route.routing, flowlines);
  const weighted = ridden.reduce((sum, { id, lengthMeters }) => sum + lengthMeters * flowlineFit(byId.get(id)!, intent), 0);
  const distance = Math.max(1, route.routing.distanceM);
  return { score: clamp01(weighted / distance / INTENT_SCORING.flowlineShareTarget), ridden: ridden.length };
};

/** Raw value of collectibles: diminishing returns per category plus a bonus for each further category. */
export const poiValue = (targets: QuestRouteTarget[]): number => {
  const byCategory = new Map<string, number[]>();
  for (const target of targets) {
    if (target.routeOnly) continue;
    const values = byCategory.get(target.category ?? "other") ?? [];
    values.push(target.alreadyAchieved ? INTENT_SCORING.achievedPoiValue : 1);
    byCategory.set(target.category ?? "other", values);
  }
  let total = 0;
  for (const values of byCategory.values()) {
    values.sort((a, b) => b - a).forEach((value, index) => { total += value * INTENT_SCORING.sameCategoryDecay ** index; });
  }
  return total + Math.max(0, byCategory.size - 1) * INTENT_SCORING.varietyBonus;
};

export interface IntentScore {
  routeQuality: number;
  flowlineQuality: number;
  interruptions: number;
  distanceFit: number;
  poiValue: number;
  total: number;
}

/** Weighted mix of route quality, Flowline quality, calmness, length fit and POI value for an intent. */
export const scoreForIntent = (
  route: ScoredRoute,
  { intent, routeType, flowlines, targets }: {
    intent: RouteIntent;
    routeType: RouteType;
    flowlines: FlowlineGeometry[];
    /** Collectibles the route contains. */
    targets: QuestRouteTarget[];
  }
): IntentScore => {
  const policy = routeIntentPolicy(intent);
  const flowline = flowlineQuality(route, flowlines, intent);
  const parts = {
    routeQuality: routeQuality(route, routeType),
    flowlineQuality: flowline.score,
    interruptions: interruptionScore(route, flowline.ridden),
    distanceFit: route.score.constraintFit,
    poiValue: clamp01(poiValue(targets) / Math.max(1, policy.pois.max))
  };
  const { weights } = policy;
  const total = weights.routeQuality * parts.routeQuality
    + weights.flowlineQuality * parts.flowlineQuality
    + weights.interruptions * parts.interruptions
    + weights.distanceFit * parts.distanceFit
    + weights.poiValue * parts.poiValue;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    routeQuality: round(parts.routeQuality),
    flowlineQuality: round(parts.flowlineQuality),
    interruptions: round(parts.interruptions),
    distanceFit: round(parts.distanceFit),
    poiValue: round(parts.poiValue),
    total: round(total)
  };
};
