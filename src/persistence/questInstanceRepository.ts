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
  evaluateQuestObjectives,
  explorationDifficulty,
  type QuestHistory
} from "../questObjectives.js";

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
  started_at: Date;
  completed_at: Date | null;
  failed_at: Date | null;
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

/**
 * Resolves the active explorations against one newly persisted activity inside its transaction.
 * An exploration is a one-activity attempt: the first activity that started after the attempt began
 * either completes it (reward granted exactly once) or fails it (retry required). Earlier activities
 * and other activities never contribute progress.
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
  }>(
    `SELECT id, title, objectives, difficulty, reward_xp FROM quest_instances
     WHERE player_id = $1 AND status = 'active' AND started_at <= $2
     ORDER BY started_at, id`,
    [playerId, activityStartedAt]
  );
  const history: QuestHistory = {
    collectibles: activityHistory.collectibles,
    flowlines: activityHistory.flowlines.map((flowline) => ({ ...flowline, activityId }))
  };
  const outcomes: QuestOutcome[] = [];
  for (const row of instances.rows) {
    const states = evaluateQuestObjectives(row.objectives, history);
    const passed = states.every((state) => state.progress.complete);
    const criteria = criteriaFromObjectives(states);
    const base = {
      questId: row.id,
      kind: "exploration" as const,
      title: row.title,
      difficulty: row.difficulty
    };
    if (passed) {
      const updated = await client.query(
        `UPDATE quest_instances
         SET status = 'completed', completed_at = now(), resolved_activity_id = $3, attempt_result = $4
         WHERE id = $1 AND player_id = $2 AND status = 'active'`,
        [row.id, playerId, activityId, JSON.stringify({ objectives: states })]
      );
      if (updated.rowCount === 1) outcomes.push({ ...base, result: "completed", xp: row.reward_xp, criteria });
    } else {
      const updated = await client.query(
        `UPDATE quest_instances
         SET status = 'failed', failed_at = now(), resolved_activity_id = $3, attempt_result = $4
         WHERE id = $1 AND player_id = $2 AND status = 'active'`,
        [row.id, playerId, activityId, JSON.stringify({ objectives: states })]
      );
      if (updated.rowCount === 1) outcomes.push({ ...base, result: "failed", xp: 0, criteria });
    }
  }
  return outcomes;
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
   * Persists a confirmed exploration and its PlannedRoute in one transaction. Progress counts
   * only from confirmation. The proposal id is the idempotency key: confirming the same proposal
   * again returns the existing exploration without changing it.
   */
  async createExploration(playerId: string, exploration: NewExploration, route: NewPlannedRoute): Promise<string> {
    const difficulty = explorationDifficulty(exploration.objectives);
    return this.inTransaction(async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO quest_instances (
          id, player_id, template_id, template_version, scope_hash,
          title, description, recommended_level, objectives, fresh_progress, difficulty, reward_xp
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, true, $9, $10)
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
          QUEST_XP_BY_DIFFICULTY[difficulty]
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
          elevation_gain_m, elevation_loss_m, geometry, included_target_ids, planner_version
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
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
          route.plannerVersion
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
         WHERE id = $1 AND player_id = $2 AND status IN ('active', 'failed')
         RETURNING template_id, template_version, scope_hash`,
        [instanceId, playerId]
      );
      if (deleted.rowCount !== 1) {
        const current = await client.query<{ status: QuestInstanceStatus }>(
          "SELECT status FROM quest_instances WHERE id = $1 AND player_id = $2",
          [instanceId, playerId]
        );
        if (current.rowCount !== 1) throw new QuestInstanceNotFoundError();
        throw new QuestInstanceStateError("Completed quests cannot be cancelled.");
      }

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

  /** Starts a new one-activity attempt for a failed exploration. */
  async retry(playerId: string, instanceId: string, startedAt: Date = new Date()): Promise<void> {
    const updated = await this.pool.query(
      `UPDATE quest_instances
       SET status = 'active', started_at = $3, attempt_count = attempt_count + 1,
           failed_at = NULL, resolved_activity_id = NULL, attempt_result = NULL
       WHERE id = $1 AND player_id = $2 AND status = 'failed'`,
      [instanceId, playerId, startedAt]
    );
    if (updated.rowCount === 1) return;
    const current = await this.pool.query("SELECT 1 FROM quest_instances WHERE id = $1 AND player_id = $2", [instanceId, playerId]);
    if (current.rowCount !== 1) throw new QuestInstanceNotFoundError();
    throw new QuestInstanceStateError("Only failed quests can be retried.");
  }

  async listForPlayer(playerId: string): Promise<QuestInstance[]> {
    const instances = await this.pool.query<InstanceRow>(
      `SELECT id, template_id, template_version, scope_hash, title, description, recommended_level,
              objectives, status, difficulty, reward_xp, attempt_count, started_at, completed_at,
              failed_at, resolved_activity_id, attempt_result
       FROM quest_instances WHERE player_id = $1
       ORDER BY started_at DESC, id`,
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
      startedAt: row.started_at.toISOString(),
      ...(row.completed_at === null ? {} : { completedAt: row.completed_at.toISOString() }),
      ...(row.failed_at === null ? {} : { failedAt: row.failed_at.toISOString() }),
      ...(row.resolved_activity_id === null ? {} : { resolvedActivityId: row.resolved_activity_id }),
      objectives: row.attempt_result?.objectives ?? evaluateQuestObjectives(row.objectives, { collectibles: [], flowlines: [] })
    }));
  }
}
