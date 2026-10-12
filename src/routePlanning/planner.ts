import type { QuestObjective } from "../domain.js";
import { cheapestInsertion, generateCandidates, improveOrder, makeCandidate, selectTargetPool, withoutTarget } from "./candidates.js";
import { buildRoutingPlan } from "./routingPlan.js";
import { DEFAULT_PLANNER_POLICY, PLANNING_LIMITS, type PlannerPolicy } from "./policy.js";
import { proposalStops, routeTargetIds, selectProposals, toRouteProposal } from "./proposals.js";
import { RoutingError } from "./routingClient.js";
import { objectiveProgress, scoreRoute } from "./scoring.js";
import { buildStrategies } from "./strategies.js";
import type {
  CandidateStop,
  FlowlineGeometry,
  ProposalStop,
  QuestRouteTarget,
  RouteCandidate,
  RoutePlanningInput,
  RouteProposal,
  RoutingRequest,
  RoutingResult,
  ScoredRoute
} from "./types.js";
import { validateRoute } from "./validation.js";

export type PlanningErrorCode = "no_reachable_targets" | "no_route" | "routing_unavailable";

export class PlanningError extends Error {
  constructor(readonly code: PlanningErrorCode, message: string) {
    super(message);
  }
}

export interface RouteProvider {
  route(request: RoutingRequest, options?: { requestId?: string; signal?: AbortSignal }): Promise<RoutingResult>;
}

export interface PlannerDependencies {
  routing: RouteProvider;
  policy?: PlannerPolicy;
  now?: () => number;
  log?: (entry: Record<string, unknown>) => void;
}

/** A planned proposal plus its ordered stops (kept server-side for later customization). */
export interface PlannedProposal {
  proposal: RouteProposal;
  stops: ProposalStop[];
}

const transientCodes = new Set(["timeout", "unavailable", "rate_limited"]);

interface QueuedCandidate {
  candidate: RouteCandidate;
  /** Objectives the candidate was built for; scores its progress and rebuilds retries. */
  objectives: QuestObjective[];
  strategy?: string;
}

interface RoutingRun {
  scored: ScoredRoute[];
  failureCodes: string[];
  routingRequests: number;
  unroutable: Set<string>;
}

/**
 * Routes queued candidates through the routing service with limited concurrency and a shared
 * deadline, validates and scores the results, and retries without targets that proved
 * unroutable. Planned-but-unserved points within walking distance are reported as nearby;
 * other near-route points are ignored.
 */
const routeCandidates = async (
  queued: QueuedCandidate[],
  { requestId, input, eligibleTargets, maxRequests, routing, policy }: {
    requestId: string;
    input: RoutePlanningInput;
    eligibleTargets: QuestRouteTarget[];
    maxRequests: number;
    routing: RouteProvider;
    policy: PlannerPolicy;
  }
): Promise<RoutingRun> => {
  const targetsById = new Map(eligibleTargets.map((target) => [target.id, target]));
  const queue: Array<QueuedCandidate> = [...queued];
  const attempted = new Set<string>();
  const unroutable = new Set<string>();
  const scored: ScoredRoute[] = [];
  const failureCodes: string[] = [];
  let routingRequests = 0;
  let stopRouting = false;
  const deadline = AbortSignal.timeout(PLANNING_LIMITS.planningDeadlineMs);

  const next = (): QueuedCandidate | undefined => {
    while (queue.length > 0) {
      const entry = queue.shift()!;
      let candidate: RouteCandidate | undefined = entry.candidate;
      for (const id of unroutable) {
        if (candidate && candidate.stops.some((stop) => stop.target.id === id)) {
          candidate = withoutTarget(input, entry.objectives, candidate, id, policy);
        }
      }
      if (!candidate || attempted.has(candidate.key)) continue;
      attempted.add(candidate.key);
      return { ...entry, candidate };
    }
    return undefined;
  };

  const evaluate = ({ candidate, objectives, strategy }: QueuedCandidate, result: RoutingResult) => {
    const validation = validateRoute(result, eligibleTargets);
    const planned = new Set(candidate.stops.map((stop) => stop.target.id));
    const nearbyTargetIds = validation.nearbyTargetIds.filter((id) => planned.has(id));
    if (validation.includedTargetIds.length + nearbyTargetIds.length === 0) {
      failureCodes.push("no_targets_served");
      return;
    }
    const progress = objectiveProgress(objectives, [...validation.includedTargetIds, ...nearbyTargetIds]);
    const includedTargets = validation.includedTargetIds.map((id) => targetsById.get(id)!).filter(Boolean);
    scored.push({
      candidate,
      routing: result,
      includedTargetIds: validation.includedTargetIds,
      nearbyTargetIds,
      objectiveProgress: progress.objectives,
      progressPotential: progress.overall,
      ...(strategy ? { strategy } : {}),
      score: scoreRoute({
        routeType: input.routeType,
        constraint: input.constraint,
        routing: result,
        estimatedDistanceM: candidate.estimatedDistanceM,
        progress: progress.overall,
        includedTargets
      }, policy)
    });
  };

  const worker = async () => {
    while (!stopRouting && !deadline.aborted && routingRequests < maxRequests) {
      const entry = next();
      if (!entry) return;
      routingRequests += 1;
      const plan = buildRoutingPlan(input.start, input.end, entry.candidate.stops);
      try {
        const result = await routing.route(plan.request, { requestId: `${requestId}-${routingRequests}`, signal: deadline });
        evaluate(entry, result);
      } catch (error) {
        const code = error instanceof RoutingError ? error.code : "unexpected";
        failureCodes.push(code);
        if (code === "rate_limited") stopRouting = true;
        if (error instanceof RoutingError && (code === "point_not_routable" || code === "snap_distance_exceeded")) {
          const targetId = error.waypointIndex !== undefined ? plan.waypointTargetIds.get(error.waypointIndex) : undefined;
          if (targetId) {
            unroutable.add(targetId);
            const retry = withoutTarget(input, entry.objectives, entry.candidate, targetId, policy);
            if (retry) queue.unshift({ ...entry, candidate: retry });
          }
        }
      }
    }
  };

  await Promise.all(Array.from({ length: PLANNING_LIMITS.routingConcurrency }, worker));
  return { scored, failureCodes, routingRequests, unroutable };
};

const noRouteError = (failureCodes: string[]): PlanningError => {
  const transientOnly = failureCodes.length > 0 && failureCodes.every((code) => transientCodes.has(code));
  return transientOnly
    ? new PlanningError("routing_unavailable", "Route planning is temporarily unavailable.")
    : new PlanningError("no_route", "No suitable route was found for this exploration.");
};

const setKey = (candidate: RouteCandidate): string => candidate.stops.map((stop) => stop.target.id).sort().join(",");

export interface GenerateExplorationRoutesInput {
  requestId: string;
  playerId: string;
  /** Correlation id for logs (the exploration session id). */
  scopeId: string;
  /** Every eligible destination of the frozen area; the planner chooses subsets itself. */
  targets: QuestRouteTarget[];
  /** Flowlines of the frozen area, analysed only after routing; never routing constraints. */
  flowlines: FlowlineGeometry[];
  input: RoutePlanningInput;
}

/**
 * Route-first generation: builds candidates for several internal target-selection strategies
 * (peak-focused, balanced, discovery), interleaves them under one routing budget and
 * returns up to three distinct, relatively labelled proposals that may contain different
 * targets. It never touches gameplay state.
 */
export const generateExplorationRoutes = async (
  { requestId, playerId, scopeId, targets, flowlines, input }: GenerateExplorationRoutesInput,
  { routing, policy = DEFAULT_PLANNER_POLICY, now = Date.now, log = (entry) => console.log(JSON.stringify(entry)) }: PlannerDependencies
): Promise<PlannedProposal[]> => {
  const startedAt = now();
  const perStrategy = buildStrategies(targets, input.constraint, policy).map((strategy) => {
    const pool = selectTargetPool(strategy.targets, strategy.objectives, input, policy);
    return {
      strategy,
      poolSize: pool.length,
      candidates: pool.length > 0 ? generateCandidates(input, strategy.objectives, pool, policy) : []
    };
  });

  // Round-robin across strategies so each gets routed; identical target sets are routed once.
  const queued: QueuedCandidate[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...perStrategy.map((entry) => entry.candidates.length));
  for (let index = 0; index < longest; index += 1) {
    for (const { strategy, candidates } of perStrategy) {
      const candidate = candidates[index];
      if (!candidate || seen.has(setKey(candidate))) continue;
      seen.add(setKey(candidate));
      queued.push({ candidate, objectives: strategy.objectives, strategy: strategy.name });
    }
  }

  const run = queued.length > 0
    ? await routeCandidates(queued, { requestId, input, eligibleTargets: targets, maxRequests: PLANNING_LIMITS.maxRoutingRequests, routing, policy })
    : { scored: [], failureCodes: [], routingRequests: 0, unroutable: new Set<string>() };
  const targetsById = new Map(targets.map((target) => [target.id, target]));
  const proposals = selectProposals(run.scored).map((selected) => ({
    proposal: toRouteProposal(selected, input, targetsById, flowlines, policy),
    stops: proposalStops(selected.route)
  }));
  log({
    event: "exploration_route_generate",
    requestId,
    playerId,
    explorationId: scopeId,
    eligibleTargetCount: targets.length,
    strategies: perStrategy.map(({ strategy, poolSize, candidates }) => ({ name: strategy.name, poolSize, candidates: candidates.length })),
    candidateCount: queued.length,
    routingRequests: run.routingRequests,
    routingFailures: run.failureCodes.length,
    failureCodes: [...new Set(run.failureCodes)].sort(),
    planningDurationMs: now() - startedAt,
    proposalCount: proposals.length
  });

  if (queued.length === 0) throw new PlanningError("no_reachable_targets", "No exploration targets are reachable with this start and ride length.");
  if (proposals.length === 0) throw noRouteError(run.failureCodes);
  return proposals;
};

export interface RerouteTargetsInput {
  requestId: string;
  playerId: string;
  scopeId: string;
  /** Proposal being customized: its label, recommendation and stop order are kept. */
  base: Pick<RouteProposal, "id" | "label" | "recommended">;
  baseStops: ProposalStop[];
  /** The exact edited target set, with objective ids assigned. */
  targets: QuestRouteTarget[];
  objectives: QuestObjective[];
  flowlines: FlowlineGeometry[];
  input: RoutePlanningInput;
}

/** Stop order for an edited target set: keep the base order, insert new targets cheaply, then 2-opt. */
export const customizedStops = (
  input: RoutePlanningInput,
  baseStops: ProposalStop[],
  targets: QuestRouteTarget[],
  policy: PlannerPolicy = DEFAULT_PLANNER_POLICY
): CandidateStop[] => {
  const byId = new Map(targets.map((target) => [target.id, target]));
  let stops: CandidateStop[] = baseStops.flatMap((stop) => {
    const target = byId.get(stop.targetId);
    if (!target) return [];
    return [{ target }];
  });
  const kept = new Set(stops.map((stop) => stop.target.id));
  for (const target of targets) {
    if (!kept.has(target.id)) stops = cheapestInsertion(input, stops, target, policy.roadFactor).stops;
  }
  return improveOrder(input, stops, policy.roadFactor);
};

/**
 * Re-plans ONE customized route for an exact target set. The route is accepted even outside the
 * requested ride length (the proposal reports how it fits); unroutable targets are dropped and
 * reported. Only the edited targets count, so removed targets the road passes are not re-added.
 */
export const rerouteTargets = async (
  { requestId, playerId, scopeId, base, baseStops, targets, objectives, flowlines, input }: RerouteTargetsInput,
  { routing, policy = DEFAULT_PLANNER_POLICY, now = Date.now, log = (entry) => console.log(JSON.stringify(entry)) }: PlannerDependencies
): Promise<PlannedProposal> => {
  const startedAt = now();
  const stops = customizedStops(input, baseStops, targets, policy);
  const candidate = makeCandidate(input, objectives, stops, "custom", policy);
  const run = await routeCandidates([{ candidate, objectives }], {
    requestId, input, eligibleTargets: targets, maxRequests: PLANNING_LIMITS.maxRerouteRequests, routing, policy
  });
  const best = [...run.scored].sort((a, b) => routeTargetIds(b).length - routeTargetIds(a).length
    || b.score.total - a.score.total)[0];
  log({
    event: "exploration_route_reroute",
    requestId,
    playerId,
    explorationId: scopeId,
    baseProposalId: base.id,
    targetCount: targets.length,
    routingRequests: run.routingRequests,
    failureCodes: [...new Set(run.failureCodes)].sort(),
    planningDurationMs: now() - startedAt,
    routed: Boolean(best)
  });
  if (!best) throw noRouteError(run.failureCodes);
  const served = new Set(routeTargetIds(best));
  const droppedTargetIds = targets.map((target) => target.id).filter((id) => !served.has(id)).sort();
  const proposal = toRouteProposal({ label: base.label, route: best, recommended: base.recommended }, input,
    new Map(targets.map((target) => [target.id, target])), flowlines, policy);
  return {
    proposal: { ...proposal, customized: true, basedOn: base.id, ...(droppedTargetIds.length > 0 ? { droppedTargetIds } : {}) },
    stops: proposalStops(best)
  };
};
