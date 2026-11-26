/**
 * The policy of "Generate route": one calm, smooth route the player can adjust. Every tunable lives
 * here as a named constant so tuning never means hunting magic numbers in the generator.
 * Staza never optimizes how fast a route can be ridden.
 */
import { distanceBetween, lineLengthMeters, sampleAlong, type LonLat } from "./geo.js";
import { PLANNING_LIMITS } from "./policy.js";
import { RIDE_STYLE_POLICIES, styleFit, type RideStyle } from "./rideStyle.js";
import { backtrackRatio, detourLengthM, routeKnots } from "./roundTrip.js";
import type { FlowlineGeometry, QuestRouteTarget, RouteType, ScoredRoute } from "./types.js";
import { traversedFlowlines } from "./validation.js";

export interface GenerationWeights {
  /** Loop shape, no retracing, no local spurs. */
  routeQuality: number;
  /** Share of the route on well-fitting Flowlines. */
  flowlineQuality: number;
  /** Few sharp turns, stops and Flowline hops (higher is calmer). */
  interruptions: number;
  /** Routed length against the aimed length. */
  distanceFit: number;
  /** Points of interest with diminishing returns per category and a variety bonus. */
  poiValue: number;
}

export interface GenerationPolicy {
  /** Share of the area-derived ride length the route aims for. */
  lengthFactor: number;
  /** Hard cap on the aimed ride length. */
  maxLengthMeters: number;
  flowlines: {
    /** Ride style whose weights rank Flowlines. */
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
  weights: GenerationWeights;
}

/** Balanced: smooth riding first, Flowlines along the way, a few collectibles only when they fit. */
export const GENERATION_POLICY: GenerationPolicy = {
  lengthFactor: 0.6,
  maxLengthMeters: 50_000,
  flowlines: { style: "balanced", max: 2, minFit: 0.4 },
  pois: { max: 2, maxDetourMeters: 1_200 },
  qualityFloor: 0.55,
  maxQualityDrop: 0.05,
  weights: { routeQuality: 0.35, flowlineQuality: 0.15, interruptions: 0.2, distanceFit: 0.2, poiValue: 0.1 }
};

/** The area-derived ride length, scaled and capped. */
export const generationLengthMeters = (areaMeters: number): number => Math.round(Math.max(
  PLANNING_LIMITS.minDistanceMeters,
  Math.min(GENERATION_POLICY.maxLengthMeters, areaMeters * GENERATION_POLICY.lengthFactor)
));

/** Scoring constants of the generator. */
export const GENERATION_SCORING = {
  /** Backtracking share that costs the whole route quality. */
  maxBacktrack: 0.5,
  /** Local spur length that costs the whole route quality. */
  detourPenaltyMeters: 1_000,
  /** Route sampling for the interruption proxy. */
  turnSampleMeters: 100,
  /** Heading change that counts as a sharp turn. */
  sharpTurnDegrees: 60,
  /** Resampling for lateral jogs; finer than turns so short side-path hops are seen. */
  jogSampleMeters: 10,
  /** Heading change that starts or ends a jog. */
  jogTurnDegrees: 45,
  /** Two opposite turns at most this far apart form a jog. */
  jogMaxSpanMeters: 80,
  /** A jog's turns cancel out to within this many degrees (the route keeps its direction). */
  jogNetDegrees: 30,
  /** Jogs per km that cost half the route quality. */
  jogsPerKmPenalty: 0.5,
  /** Route quality each small loop (knot) costs. */
  knotPenalty: 0.35,
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

/** A Flowline's fit (0..1) from its 0..100 style scores. */
export const flowlineFit = (flowline: FlowlineGeometry): number => {
  const { scores } = flowline;
  const fit = scores
    ? styleFit(RIDE_STYLE_POLICIES[GENERATION_POLICY.flowlines.style], scores) / 100
    : GENERATION_SCORING.unscoredFlowlineFit;
  return clamp01(fit) * (flowline.completed ? GENERATION_SCORING.completedFlowlineFactor : 1);
};

const headingDegrees = ([lonA, latA]: LonLat, [lonB, latB]: LonLat): number => {
  const scale = Math.cos((((latA + latB) / 2) * Math.PI) / 180);
  return (Math.atan2(latB - latA, (lonB - lonA) * scale) * 180) / Math.PI;
};

const signedTurn = (before: number, after: number): number => ((after - before + 540) % 360) - 180;

/** Evenly spaced samples in one pass (sampleAlong is quadratic on long routes). */
const resample = (coordinates: LonLat[], spacingMeters: number): LonLat[] => {
  if (coordinates.length < 2) return [...coordinates];
  const samples: LonLat[] = [coordinates[0]];
  let carried = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const [lonA, latA] = coordinates[index - 1];
    const [lonB, latB] = coordinates[index];
    const step = distanceBetween({ lat: latA, lon: lonA }, { lat: latB, lon: lonB });
    let along = spacingMeters - carried;
    while (along <= step) {
      const fraction = along / step;
      samples.push([lonA + (lonB - lonA) * fraction, latA + (latB - latA) * fraction]);
      along += spacingMeters;
    }
    carried = step - (along - spacingMeters);
  }
  samples.push(coordinates[coordinates.length - 1]);
  return samples;
};

/**
 * Lateral jogs: two opposite sharp turns close together that cancel out, e.g. a short hop onto a
 * parallel cycle path and back, or a staircase step between two streets. A rider has to brake
 * and steer twice without getting anywhere, so they cost route quality.
 */
export const lateralJogs = (coordinates: LonLat[]): number => {
  const { jogSampleMeters, jogTurnDegrees, jogMaxSpanMeters, jogNetDegrees } = GENERATION_SCORING;
  const samples = resample(coordinates, jogSampleMeters);
  const turns: Array<{ index: number; turn: number }> = [];
  for (let index = 2; index < samples.length - 2; index += 1) {
    const turn = signedTurn(headingDegrees(samples[index - 2], samples[index]), headingDegrees(samples[index], samples[index + 2]));
    if (Math.abs(turn) < jogTurnDegrees) continue;
    const last = turns[turns.length - 1];
    // Neighbouring samples of one bend are one turn.
    if (last && index - last.index <= 2 && Math.sign(last.turn) === Math.sign(turn)) {
      if (Math.abs(turn) > Math.abs(last.turn)) last.turn = turn;
      last.index = index;
    } else {
      turns.push({ index, turn });
    }
  }
  let jogs = 0;
  for (let index = 1; index < turns.length; index += 1) {
    const [a, b] = [turns[index - 1], turns[index]];
    if ((b.index - a.index) * jogSampleMeters <= jogMaxSpanMeters && Math.sign(a.turn) !== Math.sign(b.turn)
      && Math.abs(a.turn + b.turn) < jogNetDegrees) {
      jogs += 1;
      index += 1;
    }
  }
  return jogs;
};

const jogsPerKm = (coordinates: LonLat[]): number =>
  lateralJogs(coordinates) / Math.max(1, lineLengthMeters(coordinates) / 1000);

/** Route quality (0..1): loop shape and no retracing, minus backtracking, local spurs, lateral jogs and knots. */
export const routeQuality = (route: ScoredRoute, routeType: RouteType): number => {
  const coordinates = route.routing.geometry.coordinates;
  const shape = routeType === "round_trip" ? route.score.loopQuality : route.score.routeShape;
  return clamp01(shape
    - backtrackRatio(coordinates) / GENERATION_SCORING.maxBacktrack * 0.5
    - detourLengthM(coordinates) / GENERATION_SCORING.detourPenaltyMeters * 0.5
    - jogsPerKm(coordinates) / GENERATION_SCORING.jogsPerKmPenalty * 0.5
    - routeKnots(coordinates).length * GENERATION_SCORING.knotPenalty);
};

/** Sharp heading changes along the route, sampled at a fixed spacing. */
export const sharpTurns = (coordinates: LonLat[]): number => {
  const samples = sampleAlong(coordinates, GENERATION_SCORING.turnSampleMeters);
  let turns = 0;
  for (let index = 2; index < samples.length; index += 1) {
    const before = headingDegrees(samples[index - 2], samples[index - 1]);
    const after = headingDegrees(samples[index - 1], samples[index]);
    const change = Math.abs(((after - before + 540) % 360) - 180);
    if (change >= GENERATION_SCORING.sharpTurnDegrees) turns += 1;
  }
  return turns;
};

/**
 * Calmness (0..1, higher = fewer interruptions). Staza has no traffic-signal or junction data, so
 * this is a geometry proxy: sharp turns, planned stops and hops between Flowlines per km.
 * Route-only points are ridden through, so they are no stops.
 */
export const interruptionScore = (route: ScoredRoute, ridden: number): number => {
  const km = Math.max(1, lineLengthMeters(route.routing.geometry.coordinates) / 1000);
  const stops = route.candidate.stops.filter((stop) => !stop.target.routeOnly).length;
  const interruptions = sharpTurns(route.routing.geometry.coordinates) + stops + Math.max(0, ridden - 1);
  return clamp01(1 - interruptions / km / GENERATION_SCORING.maxInterruptionsPerKm);
};

/** Share of the route on Flowlines, weighted by how well each fits. */
export const flowlineQuality = (route: ScoredRoute, flowlines: FlowlineGeometry[]): { score: number; ridden: number } => {
  const byId = new Map(flowlines.map((flowline) => [flowline.id, flowline]));
  const ridden = traversedFlowlines(route.routing, flowlines);
  const weighted = ridden.reduce((sum, { id, lengthMeters }) => sum + lengthMeters * flowlineFit(byId.get(id)!), 0);
  const distance = Math.max(1, route.routing.distanceM);
  return { score: clamp01(weighted / distance / GENERATION_SCORING.flowlineShareTarget), ridden: ridden.length };
};

/** Raw value of collectibles: diminishing returns per category plus a bonus for each further category. */
export const poiValue = (targets: QuestRouteTarget[]): number => {
  const byCategory = new Map<string, number[]>();
  for (const target of targets) {
    if (target.routeOnly) continue;
    const values = byCategory.get(target.category ?? "other") ?? [];
    values.push(target.alreadyAchieved ? GENERATION_SCORING.achievedPoiValue : 1);
    byCategory.set(target.category ?? "other", values);
  }
  let total = 0;
  for (const values of byCategory.values()) {
    values.sort((a, b) => b - a).forEach((value, index) => { total += value * GENERATION_SCORING.sameCategoryDecay ** index; });
  }
  return total + Math.max(0, byCategory.size - 1) * GENERATION_SCORING.varietyBonus;
};

export interface GenerationScore {
  routeQuality: number;
  flowlineQuality: number;
  interruptions: number;
  distanceFit: number;
  poiValue: number;
  total: number;
}

/** Weighted mix of route quality, Flowline quality, calmness, length fit and POI value. */
export const scoreGeneratedRoute = (
  route: ScoredRoute,
  { routeType, flowlines, targets }: {
    routeType: RouteType;
    flowlines: FlowlineGeometry[];
    /** Collectibles the route contains. */
    targets: QuestRouteTarget[];
  }
): GenerationScore => {
  const policy = GENERATION_POLICY;
  const flowline = flowlineQuality(route, flowlines);
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
