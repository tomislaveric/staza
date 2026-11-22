import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  CollectibleCategory,
  NewPlannedRoute,
  PlannedRoute,
  QuestCriterionResult,
  QuestDifficulty,
  QuestInstance,
  QuestInstanceStatus,
  QuestObjective,
  QuestObjectiveState,
  QuestOutcome
} from "../domain.js";
import type { NewExploration } from "../exploration/service.js";
import {
  QUEST_XP_BY_DIFFICULTY,
  completedObjectiveUnits,
  evaluateQuestObjectives,
  explorationDifficulty,
  mergeObjectiveStates,
  type QuestHistory
} from "../questObjectives.js";
import type { GeoBounds } from "../worldQuery.js";

/** Template row every player-created exploration references (created by migration 028). */
export const EXPLORATION_TEMPLATE = { id: "exploration", version: 1 } as const;

interface InstanceRow {
  id: string;
  template_id: string;
  template_version: number;
  scope_hash: string;
  title: string;
  description: string;
  recommended_level: number;
  objectives: QuestObjective[];
  status: QuestInstanceStatus;
  difficulty: QuestDifficulty;
  reward_xp: number;
  attempt_count: number;
  started_at: Date | null;
  completed_at: Date | null;
  resolved_activity_id: string | null;
  attempt_result: { objectives?: QuestObjectiveState[] } | null;
}

interface PlannedRouteRow {
  id: string;
  quest_instance_id: string;
  proposal_id: string;
  profile: string;
  route_type: PlannedRoute["routeType"];
  start_lat: number;
  start_lon: number;
  end_lat: number;
  end_lon: number;
  distance_m: number;
  duration_s: number;
  elevation_gain_m: number | null;
  elevation_loss_m: number | null;
  geometry: PlannedRoute["geometry"];
  included_target_ids: string[];
  planner_version: number;
  created_at: Date;
}

const mapPlannedRoute = (row: PlannedRouteRow): PlannedRoute => ({
  id: row.id,
  questInstanceId: row.quest_instance_id,
  proposalId: row.proposal_id,
  profile: row.profile,
  routeType: row.route_type,
  start: { lat: row.start_lat, lon: row.start_lon },
  end: { lat: row.end_lat, lon: row.end_lon },
  distanceM: row.distance_m,
  durationS: row.duration_s,
  ...(row.elevation_gain_m !== null ? { elevationGainM: row.elevation_gain_m } : {}),
  ...(row.elevation_loss_m !== null ? { elevationLossM: row.elevation_loss_m } : {}),
  geometry: row.geometry,
  includedTargetIds: row.included_target_ids,
  plannerVersion: row.planner_version,
  createdAt: row.created_at.toISOString()
});

/** What one activity did, in the shape quest objectives are evaluated against. */
export interface ActivityQuestHistory {
  collectibles: Array<{ sourceId: string; category?: CollectibleCategory }>;
  flowlines: Array<{ flowlineId: string; lengthMeters: number; averageSpeedMps: number }>;
}

const criteriaFromObjectives = (states: QuestObjectiveState[]): QuestCriterionResult[] =>
  states.map((state) => ({
    label: state.objective.type === "flowline_rule"
      ? "Flowlines"
      : state.objective.type === "collectible_count"
        ? `Collectibles: ${state.objective.category.replace("_", " ")}`
        : "Targets",
    current: state.progress.completed,
    required: state.progress.required,
    met: state.progress.complete
  }));

/** A saved Exploration route as drawn on the World map (every status, same style). */
export interface ExplorationRouteSummary {
  id: string;
  title: string;
  status: QuestInstanceStatus;
  geometry: PlannedRoute["geometry"];
}

/**
 * Adds one newly persisted activity to the player's started explorations inside its transaction.
 * Progress accumulates across every activity that started at or after the exploration's start:
 * a target stays done once reached. Planned (unstarted) explorations are never touched. The
 * reward is granted exactly once, when the last objective completes.
 */
export const resolveExplorationAttemptsWithClient = async (
  client: PoolClient,
  playerId: string,
  activityId: string,
  activityStartedAt: Date,
  activityHistory: ActivityQuestHistory
): Promise<QuestOutcome[]> => {
  const instances = await client.query<{
    id: string;
    title: string;
    objectives: QuestObjective[];
    difficulty: QuestDifficulty;
    reward_xp: number;
    attempt_result: { objectives?: QuestObjectiveState[] } | null;
  }>(
    `SELECT id, title, objectives, difficulty, reward_xp, attempt_result FROM quest_instances
     WHERE player_id = $1 AND status IN ('active', 'partially_completed') AND started_at <= $2
       AND jsonb_array_length(objectives) > 0
     ORDER BY started_at, id
     FOR UPDATE`,
    [playerId, activityStartedAt]
  );
  const history: QuestHistory = {
    collectibles: activityHistory.collectibles,
    flowlines: activityHistory.flowlines.map((flowline) => ({ ...flowline, activityId }))
  };
  const outcomes: QuestOutcome[] = [];
  for (const row of instances.rows) {
    const previous = row.attempt_result?.objectives;
    const states = mergeObjectiveStates(previous, evaluateQuestObjectives(row.objectives, history));
    if (completedObjectiveUnits(states) <= completedObjectiveUnits(previous ?? [])) continue;
    const passed = states.every((state) => state.progress.complete);
    const base = {
      questId: row.id,
      kind: "exploration" as const,
      title: row.title,
      difficulty: row.difficulty,
      criteria: criteriaFromObjectives(states)
    };
    const updated = await client.query(
      `UPDATE quest_instances
       SET status = $5, completed_at = CASE WHEN $5 = 'completed' THEN now() ELSE NULL END,
           resolved_activity_id = $3, attempt_result = $4
       WHERE id = $1 AND player_id = $2 AND status IN ('active', 'partially_completed')`,
      [row.id, playerId, activityId, JSON.stringify({ objectives: states }), passed ? "completed" : "partially_completed"]
    );
    if (updated.rowCount !== 1) continue;
    outcomes.push(passed
      ? { ...base, result: "completed", xp: row.reward_xp }
      : { ...base, result: "progressed", xp: 0 });
  }
  return outcomes;
};

const routeBounds = (route: NewPlannedRoute): [number, number, number, number] => {
  const points: [number, number][] = [
    ...route.geometry.coordinates,
    [route.start.lon, route.start.lat],
    [route.end.lon, route.end.lat]
  ];
  return points.reduce<[number, number, number, number]>(
    ([minLat, minLon, maxLat, maxLon], [lon, lat]) =>
      [Math.min(minLat, lat), Math.min(minLon, lon), Math.max(maxLat, lat), Math.max(maxLon, lon)],
    [Infinity, Infinity, -Infinity, -Infinity]
  );
};

export class QuestInstanceNotFoundError extends Error {
  constructor() {
    super("Quest instance not found.");
  }
}

export class QuestInstanceStateError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class QuestInstanceRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Saves an exploration as `planned` with its PlannedRoute in one transaction. It makes no
   * progress until started. The proposal id is the idempotency key: saving the same proposal
   * again returns the existing exploration without changing it.
   */
  async createExploration(playerId: string, exploration: NewExploration, route: NewPlannedRoute): Promise<string> {
    const difficulty = explorationDifficulty(exploration.objectives);
    return this.inTransaction(async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO quest_instances (
          id, player_id, template_id, template_version, scope_hash,
          title, description, recommended_level, objectives, fresh_progress, difficulty, reward_xp,
          status, started_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, true, $9, $10, 'planned', NULL)
        ON CONFLICT (player_id, template_id, template_version, scope_hash) DO NOTHING
        RETURNING id`,
        [
          randomUUID(),
          playerId,
          EXPLORATION_TEMPLATE.id,
          EXPLORATION_TEMPLATE.version,
          exploration.proposalId,
          exploration.title,
          exploration.description,
          JSON.stringify(exploration.objectives),
          difficulty,
          // A route-only exploration has no objectives to complete, so it never pays XP.
          exploration.objectives.length === 0 ? 0 : QUEST_XP_BY_DIFFICULTY[difficulty]
        ]
      );
      if (inserted.rowCount !== 1) {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM quest_instances
           WHERE player_id = $1 AND template_id = $2 AND template_version = $3 AND scope_hash = $4`,
          [playerId, EXPLORATION_TEMPLATE.id, EXPLORATION_TEMPLATE.version, exploration.proposalId]
        );
        if (existing.rowCount !== 1) throw new Error("Unable to resolve an existing exploration.");
        return existing.rows[0].id;
      }
      const instanceId = inserted.rows[0].id;
      await client.query(
        `INSERT INTO planned_routes (
          id, player_id, quest_instance_id, proposal_id, profile, route_type,
          start_lat, start_lon, end_lat, end_lon, distance_m, duration_s,
          elevation_gain_m, elevation_loss_m, geometry, included_target_ids, planner_version,
          min_lat, min_lon, max_lat, max_lon
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
        [
          randomUUID(),
          playerId,
          instanceId,
          route.proposalId,
          route.profile,
          route.routeType,
          route.start.lat,
          route.start.lon,
          route.end.lat,
          route.end.lon,
          route.distanceM,
          route.durationS,
          route.elevationGainM ?? null,
          route.elevationLossM ?? null,
          JSON.stringify(route.geometry),
          JSON.stringify(route.includedTargetIds),
          route.plannerVersion,
          ...routeBounds(route)
        ]
      );
      return instanceId;
    });
  }

  async getPlannedRoute(playerId: string, instanceId: string): Promise<PlannedRoute | undefined> {
    const result = await this.pool.query<PlannedRouteRow>(
      `SELECT id, quest_instance_id, proposal_id, profile, route_type, start_lat, start_lon, end_lat, end_lon,
              distance_m, duration_s, elevation_gain_m, elevation_loss_m, geometry, included_target_ids,
              planner_version, created_at
       FROM planned_routes
       WHERE quest_instance_id = $1 AND player_id = $2`,
      [instanceId, playerId]
    );
    return result.rows[0] ? mapPlannedRoute(result.rows[0]) : undefined;
  }

  private async inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async cancel(playerId: string, instanceId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const deleted = await client.query<{
        template_id: string;
        template_version: number;
        scope_hash: string;
      }>(
        `DELETE FROM quest_instances
         WHERE id = $1 AND player_id = $2
         RETURNING template_id, template_version, scope_hash`,
        [instanceId, playerId]
      );
      if (deleted.rowCount !== 1) throw new QuestInstanceNotFoundError();

      const cancelled = deleted.rows[0];
      await client.query(
        `INSERT INTO quest_instance_cancellations (
          player_id, template_id, template_version, scope_hash, cancelled_at
        ) VALUES ($1, $2, $3, $4, now())
        ON CONFLICT (player_id, template_id, template_version, scope_hash)
        DO UPDATE SET cancelled_at = EXCLUDED.cancelled_at`,
        [playerId, cancelled.template_id, cancelled.template_version, cancelled.scope_hash]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Starts a saved exploration: activities from now on add progress. */
  async start(playerId: string, instanceId: string, startedAt: Date = new Date()): Promise<void> {
    const updated = await this.pool.query(
      `UPDATE quest_instances SET status = 'active', started_at = $3
       WHERE id = $1 AND player_id = $2 AND status = 'planned'`,
      [instanceId, playerId, startedAt]
    );
    if (updated.rowCount === 1) return;
    const current = await this.pool.query("SELECT 1 FROM quest_instances WHERE id = $1 AND player_id = $2", [instanceId, playerId]);
    if (current.rowCount !== 1) throw new QuestInstanceNotFoundError();
    throw new QuestInstanceStateError("Only planned explorations can be started.");
  }

  /** Saved exploration routes whose bounds overlap the viewport, newest first. */
  async listRoutesWithinBounds(playerId: string, bounds: GeoBounds, limit = 50): Promise<ExplorationRouteSummary[]> {
    const result = await this.pool.query<{ id: string; title: string; status: QuestInstanceStatus; geometry: PlannedRoute["geometry"] }>(
      `SELECT q.id, q.title, q.status, r.geometry
       FROM planned_routes AS r
       INNER JOIN quest_instances AS q ON q.id = r.quest_instance_id AND q.player_id = r.player_id
       WHERE r.player_id = $1
         AND r.max_lon >= $2 AND r.min_lon <= $3 AND r.max_lat >= $4 AND r.min_lat <= $5
       ORDER BY r.created_at DESC, q.id
       LIMIT $6`,
      [playerId, bounds.minLongitude, bounds.maxLongitude, bounds.minLatitude, bounds.maxLatitude, limit]
    );
    return result.rows.map((row) => ({ id: row.id, title: row.title, status: row.status, geometry: row.geometry }));
  }

  async listForPlayer(playerId: string): Promise<QuestInstance[]> {
    const instances = await this.pool.query<InstanceRow>(
      `SELECT id, template_id, template_version, scope_hash, title, description, recommended_level,
              objectives, status, difficulty, reward_xp, attempt_count, started_at, completed_at,
              resolved_activity_id, attempt_result
       FROM quest_instances WHERE player_id = $1
       ORDER BY started_at DESC NULLS FIRST, id`,
      [playerId]
    );
    return instances.rows.map((row): QuestInstance => ({
      id: row.id,
      suggestionId: row.scope_hash,
      templateId: row.template_id,
      templateVersion: row.template_version,
      title: row.title,
      description: row.description,
      recommendedLevel: row.recommended_level,
      status: row.status,
      difficulty: row.difficulty,
      rewardXp: row.reward_xp,
      attemptCount: row.attempt_count,
      ...(row.started_at === null ? {} : { startedAt: row.started_at.toISOString() }),
      ...(row.completed_at === null ? {} : { completedAt: row.completed_at.toISOString() }),
      ...(row.resolved_activity_id === null ? {} : { resolvedActivityId: row.resolved_activity_id }),
      objectives: row.attempt_result?.objectives ?? evaluateQuestObjectives(row.objectives, { collectibles: [], flowlines: [] })
    }));
  }
}
