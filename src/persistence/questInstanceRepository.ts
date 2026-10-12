import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  CollectibleCategory,
  NewPlannedRoute,
  PlannedRoute,
  QuestInstance,
  QuestObjective,
  QuestObjectiveState
} from "../domain.js";
import type { NewExploration } from "../exploration/service.js";
import { evaluateQuestObjectives, type QuestHistory } from "../questObjectives.js";

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
  status: "active" | "completed";
  started_at: Date;
  completed_at: Date | null;
  fresh_progress: boolean;
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

interface TimedCollectibleHistory {
  sourceId: string;
  category?: CollectibleCategory;
  timestampMs: number;
}

interface TimedFlowlineHistory {
  flowlineId: string;
  activityId: string;
  lengthMeters: number;
  averageSpeedMps: number;
  timestampMs: number;
}

export const historyFromQuestStart = (
  history: { collectibles: TimedCollectibleHistory[]; flowlines: TimedFlowlineHistory[] },
  startedAtMs: number
): QuestHistory => {
  return {
    collectibles: history.collectibles
      .filter((event) => event.timestampMs >= startedAtMs)
      .map(({ sourceId, category }) => ({
        sourceId,
        ...(category === undefined ? {} : { category })
      })),
    flowlines: history.flowlines
      .filter((completion) => completion.timestampMs >= startedAtMs)
      .map(({ flowlineId, activityId, lengthMeters, averageSpeedMps, timestampMs }) => ({
        flowlineId,
        activityId,
        lengthMeters,
        averageSpeedMps,
        timestampMs
      }))
  };
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
    return this.inTransaction(async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO quest_instances (
          id, player_id, template_id, template_version, scope_hash,
          title, description, recommended_level, objectives, fresh_progress
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, true)
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
          JSON.stringify(exploration.objectives)
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
         WHERE id = $1 AND player_id = $2 AND status = 'active'
         RETURNING template_id, template_version, scope_hash`,
        [instanceId, playerId]
      );
      if (deleted.rowCount !== 1) {
        const current = await client.query<{ status: "active" | "completed" }>(
          "SELECT status FROM quest_instances WHERE id = $1 AND player_id = $2",
          [instanceId, playerId]
        );
        if (current.rowCount !== 1) throw new QuestInstanceNotFoundError();
        throw new QuestInstanceStateError("Only active quests can be cancelled.");
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

  async listForPlayer(playerId: string): Promise<QuestInstance[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const instances = await client.query<InstanceRow>(
        `SELECT id, template_id, template_version, scope_hash, title, description, recommended_level,
                objectives, status, started_at, completed_at, fresh_progress
         FROM quest_instances WHERE player_id = $1
         ORDER BY started_at DESC, id`,
        [playerId]
      );
      if (instances.rowCount === 0) {
        await client.query("COMMIT");
        return [];
      }
      const collectibleTargetIds = new Set<string>();
      const flowlineTargetIds = new Set<string>();
      for (const instance of instances.rows) {
        for (const objective of instance.objectives) {
          const targetIds = objective.targets.map((target) => target.id);
          if (objective.type === "flowline_rule") {
            targetIds.forEach((id) => flowlineTargetIds.add(id));
          } else {
            targetIds.forEach((id) => collectibleTargetIds.add(id));
          }
        }
      }
      const [collectibleHistory, flowlineHistory] = await Promise.all([
        collectibleTargetIds.size === 0
          ? Promise.resolve({ rows: [] as Array<{
            source_id: string;
            collectible_category: CollectibleCategory | null;
            activity_timestamp: number | string;
          }> })
          : client.query<{
            source_id: string;
            collectible_category: CollectibleCategory | null;
            activity_timestamp: number | string;
          }>(
          `SELECT DISTINCT events.source_id, events.collectible_category, events.activity_timestamp
           FROM activity_events AS events
           INNER JOIN activities ON activities.id = events.activity_id
           WHERE activities.player_id = $1 AND events.source_id = ANY($2::text[])`,
          [playerId, [...collectibleTargetIds]]
        ),
        flowlineTargetIds.size === 0
          ? Promise.resolve({ rows: [] as Array<{
            fartlek_id: string;
            activity_id: string;
            fartlek_length_m_snapshot: number;
            average_speed_mps: number;
            completed_at: Date;
          }> })
          : client.query<{
          fartlek_id: string;
          activity_id: string;
          fartlek_length_m_snapshot: number;
          average_speed_mps: number;
          completed_at: Date;
        }>(
          `SELECT fartlek_id, activity_id, fartlek_length_m_snapshot, average_speed_mps, completed_at
           FROM fartlek_completions WHERE player_id = $1 AND fartlek_id = ANY($2::text[])`,
          [playerId, [...flowlineTargetIds]]
        )
      ]);
      const timedHistory = {
        collectibles: collectibleHistory.rows.map((row) => ({
          sourceId: row.source_id,
          ...(row.collectible_category === null ? {} : { category: row.collectible_category }),
          timestampMs: Number(row.activity_timestamp)
        })),
        flowlines: flowlineHistory.rows.map((row) => ({
          flowlineId: row.fartlek_id,
          activityId: row.activity_id,
          lengthMeters: row.fartlek_length_m_snapshot,
          averageSpeedMps: row.average_speed_mps,
          timestampMs: row.completed_at.getTime()
        }))
      };
      const mapped: QuestInstance[] = [];
      for (const row of instances.rows) {
        const history = row.fresh_progress
          ? historyFromQuestStart(timedHistory, row.started_at.getTime())
          : {
            collectibles: timedHistory.collectibles.map(({ sourceId, category }) => ({
              sourceId,
              ...(category === undefined ? {} : { category })
            })),
            flowlines: timedHistory.flowlines.map(({ flowlineId, activityId, lengthMeters, averageSpeedMps, timestampMs }) => ({
              flowlineId,
              activityId,
              lengthMeters,
              averageSpeedMps,
              timestampMs
            }))
          };
        const objectiveStates: QuestObjectiveState[] = evaluateQuestObjectives(row.objectives, history);
        const complete = objectiveStates.every((state) => state.progress.complete);
        let status = row.status;
        let completedAt = row.completed_at;
        if (complete && status !== "completed") {
          const updated = await client.query<{ completed_at: Date }>(
            `UPDATE quest_instances SET status = 'completed', completed_at = now()
             WHERE id = $1 AND player_id = $2 AND status = 'active'
             RETURNING completed_at`,
            [row.id, playerId]
          );
          if (updated.rowCount === 1) {
            status = "completed";
            completedAt = updated.rows[0].completed_at;
          } else {
            const stored = await client.query<{ status: "active" | "completed"; completed_at: Date | null }>(
              "SELECT status, completed_at FROM quest_instances WHERE id = $1 AND player_id = $2",
              [row.id, playerId]
            );
            status = stored.rows[0]?.status ?? status;
            completedAt = stored.rows[0]?.completed_at ?? completedAt;
          }
        }
        mapped.push({
          id: row.id,
          suggestionId: row.scope_hash,
          templateId: row.template_id,
          templateVersion: row.template_version,
          title: row.title,
          description: row.description,
          recommendedLevel: row.recommended_level,
          status,
          startedAt: row.started_at.toISOString(),
          ...(completedAt === null ? {} : { completedAt: completedAt.toISOString() }),
          objectives: objectiveStates
        });
      }
      await client.query("COMMIT");
      return mapped;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
