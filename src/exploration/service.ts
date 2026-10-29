import { randomUUID } from "node:crypto";
import type { NewPlannedRoute, QuestObjective, WorldCollectible, WorldFartlek } from "../domain.js";
import { UserInputError } from "../errors.js";
import { generateAreaRoutes, generateExplorationRoutes, PlanningError, rerouteTargets, type PlannedProposal, type RouteProvider } from "../routePlanning/planner.js";
import { PLANNING_LIMITS } from "../routePlanning/policy.js";
import type { ProposalStore } from "../routePlanning/proposalStore.js";
import { routeTargetIds } from "../routePlanning/proposals.js";
import { insideBounds } from "../routePlanning/validation.js";
import { assertNearTargets, parseProposalId } from "../routePlanning/request.js";
import { constraintActual, constraintRequested } from "../routePlanning/scoring.js";
import { profileForSport } from "../routePlanning/sport.js";
import { buildExplorationTargets, buildFlowlineGeometries, MAX_AVAILABLE_TARGETS } from "../routePlanning/targets.js";
import { PLANNER_VERSION, type QuestRouteTarget, type RoutePlanningInput, type RouteProposal } from "../routePlanning/types.js";
import type { GeoBounds } from "../worldQuery.js";
import { describeExploration, explorationObjectives, withObjectiveIds } from "./objectives.js";
import { parseExplorationId, parseGenerateRequest, parseRerouteRequest } from "./request.js";
import type { ExplorationSessionStore } from "./sessionStore.js";

/** Exploration persisted on confirmation; its id is the confirmed proposal id (idempotency key). */
export interface NewExploration {
  proposalId: string;
  title: string;
  description: string;
  objectives: QuestObjective[];
}

export interface ExplorationDependencies {
  /** Eligible World objects of the frozen area for the player, nearest to the area center first. */
  loadArea(playerId: string, bounds: GeoBounds): Promise<{ collectibles: WorldCollectible[]; flowlines: WorldFartlek[]; truncated: boolean }>;
  /** Undefined when no routing service is configured. */
  routing?: RouteProvider;
  sessions: ExplorationSessionStore;
  proposals: ProposalStore;
  explorations: {
    createExploration(playerId: string, exploration: NewExploration, route: NewPlannedRoute): Promise<string>;
  };
  log?: (entry: Record<string, unknown>) => void;
}

export type ExplorationErrorCode =
  | "planning_unavailable"
  | "exploration_expired"
  | "proposal_expired"
  | "no_targets"
  | "no_reachable_targets"
  | "no_route";

const statusByCode: Record<ExplorationErrorCode, number> = {
  planning_unavailable: 503,
  exploration_expired: 409,
  proposal_expired: 409,
  no_targets: 422,
  no_reachable_targets: 422,
  no_route: 422
};

const messageByCode: Record<ExplorationErrorCode, string> = {
  planning_unavailable: "Route planning is temporarily unavailable. Try again later.",
  exploration_expired: "This exploration has expired. Generate routes again.",
  proposal_expired: "This route has expired. Generate routes again.",
  no_targets: "No exploration targets found in this area. Move the map and try again.",
  no_reachable_targets: "No exploration targets can be reached with this start and ride length. Try a longer ride or another start.",
  no_route: "No suitable route was found. Try another start, destination or ride length."
};

/** User-safe exploration failure with a stable code and HTTP status. */
export class ExplorationError extends Error {
  readonly status: number;

  constructor(readonly code: ExplorationErrorCode) {
    super(messageByCode[code]);
    this.status = statusByCode[code];
  }
}

/** Proposal as returned to clients; internal scoring details stay on the server. */
export type PublicRouteProposal = Omit<RouteProposal, "score">;

const toPublic = ({ score: _score, ...proposal }: RouteProposal): PublicRouteProposal => proposal;

/** Reported when the frozen area cannot supply a route near the requested length. */
export interface InsufficientAreaWarning {
  code: "insufficient_area";
  requestedType: "distance" | "duration";
  /** Meters or seconds, per `requestedType`. */
  requested: number;
  /** Longest route found, in the same unit as `requested`. */
  longest: number;
  message: string;
}

export type ExplorationWarning = InsufficientAreaWarning;

const insufficientAreaWarning = (input: RoutePlanningInput, proposals: RouteProposal[]): InsufficientAreaWarning => {
  const requested = constraintRequested(input.constraint);
  const longest = Math.round(Math.max(...proposals.map((proposal) => constraintActual(input.constraint, proposal))));
  const format = (value: number) => input.constraint.type === "distance"
    ? `${(value / 1000).toFixed(value >= 100_000 ? 0 : 1)} km`
    : `${Math.floor(value / 3600)}:${String(Math.round((value % 3600) / 60)).padStart(2, "0")} h`;
  return {
    code: "insufficient_area",
    requestedType: input.constraint.type,
    requested,
    longest,
    message: `This area can't support a ${format(requested)} route. The longest route found is ${format(longest)}. Try a longer start-to-destination, another area or a shorter ${input.constraint.type === "distance" ? "distance" : "time"}.`
  };
};

export interface GeneratedExploration {
  explorationId: string;
  proposals: PublicRouteProposal[];
  /** Eligible destinations (collectibles) and the area's Flowlines: rendered for the selected route and while adding destinations. */
  catalog: { collectibles: WorldCollectible[]; flowlines: WorldFartlek[] };
  truncated: boolean;
  limits: { maxRouteTargets: number; maxRouteWaypoints: number };
  warnings: ExplorationWarning[];
}

const planningFailure = (error: unknown): unknown => error instanceof PlanningError
  ? new ExplorationError(error.code === "routing_unavailable" ? "planning_unavailable" : error.code)
  : error;

/**
 * Route-first "Explore this Area": the player describes the ride, the planner chooses target
 * combinations and returns a few route proposals, the player may customize one route's targets,
 * and only the confirmed route is persisted. Planning never changes gameplay state.
 */
export class ExplorationService {
  constructor(private readonly dependencies: ExplorationDependencies) {}

  private requireRouting(): RouteProvider {
    if (!this.dependencies.routing) throw new ExplorationError("planning_unavailable");
    return this.dependencies.routing;
  }

  private store(explorationId: string, planned: PlannedProposal, available: Map<string, QuestRouteTarget>, input: RoutePlanningInput) {
    return {
      sport: input.sport,
      explorationId,
      proposal: planned.proposal,
      stops: planned.stops,
      targets: routeTargetIds(planned.proposal).map((id) => available.get(id)!).filter(Boolean),
      plannerVersion: PLANNER_VERSION
    };
  }

  /** Freezes the area, resolves its eligible targets and generates the initial route proposals. */
  async generate(playerId: string, body: unknown, requestId: string = randomUUID()): Promise<GeneratedExploration> {
    const routing = this.requireRouting();
    const { area, input } = parseGenerateRequest(body);
    if (input.routeType === "point_to_point" && !insideBounds([input.end.lon, input.end.lat], area.bounds, 0)) {
      throw new UserInputError("The destination must be inside the explored area.");
    }
    const viewport = await this.dependencies.loadArea(playerId, area.bounds);
    const inArea = ({ latitude, longitude }: { latitude: number; longitude: number }) => insideBounds([longitude, latitude], area.bounds, 0);
    // Destinations must lie inside the frozen area, whatever the world query returned.
    const world = {
      collectibles: viewport.collectibles.filter(inArea),
      flowlines: viewport.flowlines,
      truncated: viewport.truncated
    };
    const resolve = () => {
      const built = buildExplorationTargets(world.collectibles);
      const flowlineGeometries = buildFlowlineGeometries(world.flowlines).slice(0, MAX_AVAILABLE_TARGETS);
      return { ...built, flowlineGeometries };
    };
    const resolved = resolve();
    // Without collectibles the area itself is the exploration: route-only loops, no objectives.
    if (resolved.targets.length > 0) assertNearTargets(input, resolved.targets);
    const sessionData = (current: typeof resolved) => {
      const ids = new Set(current.targets.map((target) => target.id));
      const flowlineIds = new Set(current.flowlineGeometries.map((flowline) => flowline.id));
      return {
        availableTargets: current.targets,
        collectibles: world.collectibles.filter((collectible) => ids.has(collectible.id)),
        flowlines: world.flowlines.filter((flowline) => flowlineIds.has(flowline.id)),
        flowlineGeometries: current.flowlineGeometries,
        truncated: current.truncated || world.truncated
      };
    };
    const session = this.dependencies.sessions.create({ playerId, area, input, ...sessionData(resolved) });

    const plan = async (current: typeof resolved): Promise<{ planned?: PlannedProposal[]; failure?: unknown }> => {
      try {
        const dependencies = { routing, ...(this.dependencies.log ? { log: this.dependencies.log } : {}) };
        return {
          planned: current.targets.length === 0
            ? await generateAreaRoutes(
              { requestId, playerId, scopeId: session.id, flowlines: current.flowlineGeometries, input, bounds: area.bounds },
              dependencies
            )
            : await generateExplorationRoutes(
              { requestId, playerId, scopeId: session.id, targets: current.targets, flowlines: current.flowlineGeometries, input, bounds: area.bounds },
              dependencies
            )
        };
      } catch (failure) {
        return { failure };
      }
    };
    const { planned, failure } = await plan(resolved);
    if (!planned) throw planningFailure(failure);
    // A newer exploration started while routing; this one's proposals are already stale.
    if (!this.dependencies.sessions.get(playerId, session.id)) throw new ExplorationError("exploration_expired");
    const available = new Map(session.availableTargets.map((target) => [target.id, target]));
    const warnings: ExplorationWarning[] = planned.every((entry) => entry.proposal.constraintFit === "short")
      ? [insufficientAreaWarning(input, planned.map((entry) => entry.proposal))]
      : [];
    this.dependencies.proposals.replaceForPlayer(playerId, planned.map((entry) => this.store(session.id, entry, available, input)));
    return {
      explorationId: session.id,
      proposals: planned.map((entry) => toPublic(entry.proposal)),
      catalog: { collectibles: session.collectibles, flowlines: session.flowlines },
      truncated: session.truncated,
      limits: { maxRouteTargets: PLANNING_LIMITS.maxRouteTargets, maxRouteWaypoints: PLANNING_LIMITS.maxRouteWaypoints },
      warnings
    };
  }

  /**
   * Re-plans one proposal for an edited target set from the frozen area. Other proposals are not
   * touched, and the base proposal stays confirmable (the player may reset to it).
   */
  async reroute(playerId: string, explorationIdValue: unknown, body: unknown, requestId: string = randomUUID()): Promise<{ proposal: PublicRouteProposal }> {
    const routing = this.requireRouting();
    const explorationId = parseExplorationId(explorationIdValue);
    const { proposalId, targetIds, waypoints } = parseRerouteRequest(body);
    const session = this.dependencies.sessions.get(playerId, explorationId);
    if (!session) throw new ExplorationError("exploration_expired");
    const base = this.dependencies.proposals.get(playerId, proposalId);
    if (!base || base.explorationId !== session.id) throw new ExplorationError("proposal_expired");
    const available = new Map(session.availableTargets.map((target) => [target.id, target]));
    if (targetIds.some((id) => !available.has(id))) {
      throw new UserInputError("Only targets from the explored area can be added.");
    }
    if (waypoints.some((point) => !insideBounds([point.lon, point.lat], session.area.bounds, 0))) {
      throw new UserInputError("Map points must be inside the explored area.");
    }
    const chosen = targetIds.map((id) => available.get(id)!);
    const objectives = explorationObjectives(chosen);
    let planned: PlannedProposal;
    try {
      planned = await rerouteTargets({
        requestId,
        playerId,
        scopeId: session.id,
        base: base.proposal,
        baseStops: base.stops,
        targets: withObjectiveIds(chosen, objectives),
        objectives,
        flowlines: session.flowlineGeometries,
        input: session.input,
        bounds: session.area.bounds,
        waypoints
      }, { routing, ...(this.dependencies.log ? { log: this.dependencies.log } : {}) });
    } catch (error) {
      throw planningFailure(error);
    }
    this.dependencies.proposals.addForPlayer(playerId, this.store(session.id, planned, available, session.input));
    return { proposal: toPublic(planned.proposal) };
  }

  /**
   * Persists the exploration and its route. The client sends only the proposal id; targets,
   * geometry and objectives come from server memory, so they cannot be tampered with. Repeating
   * a confirmation returns the same exploration.
   */
  async confirm(playerId: string, body: unknown): Promise<string> {
    const proposalId = parseProposalId(body);
    const stored = this.dependencies.proposals.get(playerId, proposalId);
    if (!stored) throw new ExplorationError("proposal_expired");
    const { proposal, plannerVersion, targets, sport } = stored;
    const { title, description } = describeExploration(targets);
    return this.dependencies.explorations.createExploration(playerId, {
      proposalId: proposal.id,
      title,
      description,
      objectives: explorationObjectives(targets)
    }, {
      proposalId: proposal.id,
      profile: profileForSport(sport),
      routeType: proposal.routeType,
      start: proposal.start,
      end: proposal.end,
      distanceM: proposal.distanceM,
      durationS: proposal.durationS,
      ...(proposal.elevationGainM !== undefined ? { elevationGainM: proposal.elevationGainM } : {}),
      ...(proposal.elevationLossM !== undefined ? { elevationLossM: proposal.elevationLossM } : {}),
      geometry: proposal.geometry,
      includedTargetIds: proposal.includedTargetIds,
      plannerVersion
    });
  }
}
