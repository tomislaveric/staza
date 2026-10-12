import { randomUUID } from "node:crypto";
import type { NewPlannedRoute, QuestObjective, WorldCollectible, WorldFartlek } from "../domain.js";
import { UserInputError } from "../errors.js";
import { generateExplorationRoutes, PlanningError, rerouteTargets, type PlannedProposal, type RouteProvider } from "../routePlanning/planner.js";
import { PLANNING_LIMITS } from "../routePlanning/policy.js";
import type { ProposalStore } from "../routePlanning/proposalStore.js";
import { routeTargetIds } from "../routePlanning/proposals.js";
import { assertNearTargets, parseProposalId } from "../routePlanning/request.js";
import { buildExplorationTargets, buildFlowlineGeometries, MAX_AVAILABLE_TARGETS } from "../routePlanning/targets.js";
import { PLANNER_VERSION, type QuestRouteTarget, type RouteProposal } from "../routePlanning/types.js";
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

export interface GeneratedExploration {
  explorationId: string;
  proposals: PublicRouteProposal[];
  /** Eligible destinations (collectibles) and the area's Flowlines: rendered for the selected route and while adding destinations. */
  catalog: { collectibles: WorldCollectible[]; flowlines: WorldFartlek[] };
  truncated: boolean;
  limits: { maxRouteTargets: number };
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

  private store(playerId: string, explorationId: string, planned: PlannedProposal, available: Map<string, QuestRouteTarget>) {
    return {
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
    const loaded = await this.dependencies.loadArea(playerId, area.bounds);
    const { targets, truncated } = buildExplorationTargets(loaded.collectibles);
    const flowlineGeometries = buildFlowlineGeometries(loaded.flowlines).slice(0, MAX_AVAILABLE_TARGETS);
    const flowlineIds = new Set(flowlineGeometries.map((flowline) => flowline.id));
    if (targets.length === 0) throw new ExplorationError("no_targets");
    assertNearTargets(input, targets);
    const ids = new Set(targets.map((target) => target.id));
    const session = this.dependencies.sessions.create({
      playerId,
      area,
      input,
      availableTargets: targets,
      collectibles: loaded.collectibles.filter((collectible) => ids.has(collectible.id)),
      flowlines: loaded.flowlines.filter((flowline) => flowlineIds.has(flowline.id)),
      flowlineGeometries,
      truncated: truncated || loaded.truncated
    });

    let planned: PlannedProposal[];
    try {
      planned = await generateExplorationRoutes(
        { requestId, playerId, scopeId: session.id, targets, flowlines: flowlineGeometries, input },
        { routing, ...(this.dependencies.log ? { log: this.dependencies.log } : {}) }
      );
    } catch (error) {
      throw planningFailure(error);
    }
    // A newer exploration started while routing; this one's proposals are already stale.
    if (!this.dependencies.sessions.get(playerId, session.id)) throw new ExplorationError("exploration_expired");
    const available = new Map(targets.map((target) => [target.id, target]));
    this.dependencies.proposals.replaceForPlayer(playerId, planned.map((entry) => this.store(playerId, session.id, entry, available)));
    return {
      explorationId: session.id,
      proposals: planned.map((entry) => toPublic(entry.proposal)),
      catalog: { collectibles: session.collectibles, flowlines: session.flowlines },
      truncated: session.truncated,
      limits: { maxRouteTargets: PLANNING_LIMITS.maxRouteTargets }
    };
  }

  /**
   * Re-plans one proposal for an edited target set from the frozen area. Other proposals are not
   * touched, and the base proposal stays confirmable (the player may reset to it).
   */
  async reroute(playerId: string, explorationIdValue: unknown, body: unknown, requestId: string = randomUUID()): Promise<{ proposal: PublicRouteProposal }> {
    const routing = this.requireRouting();
    const explorationId = parseExplorationId(explorationIdValue);
    const { proposalId, targetIds } = parseRerouteRequest(body);
    const session = this.dependencies.sessions.get(playerId, explorationId);
    if (!session) throw new ExplorationError("exploration_expired");
    const base = this.dependencies.proposals.get(playerId, proposalId);
    if (!base || base.explorationId !== session.id) throw new ExplorationError("proposal_expired");
    const available = new Map(session.availableTargets.map((target) => [target.id, target]));
    if (targetIds.some((id) => !available.has(id))) {
      throw new UserInputError("Only targets from the explored area can be added.");
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
        input: session.input
      }, { routing, ...(this.dependencies.log ? { log: this.dependencies.log } : {}) });
    } catch (error) {
      throw planningFailure(error);
    }
    this.dependencies.proposals.addForPlayer(playerId, this.store(playerId, session.id, planned, available));
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
    const { proposal, plannerVersion, targets } = stored;
    const { title, description } = describeExploration(targets);
    return this.dependencies.explorations.createExploration(playerId, {
      proposalId: proposal.id,
      title,
      description,
      objectives: explorationObjectives(targets)
    }, {
      proposalId: proposal.id,
      profile: "bicycle",
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
