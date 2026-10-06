import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { FartlekCompletion, FartlekCompletionDraft, FartlekCompletionSummary } from "../domain.js";

interface CompletionRow {
  id: string;
  fartlek_id: string;
  player_id: string;
  activity_id: string;
  completed_at: Date;
  elapsed_time_s: number;
  average_speed_mps: number;
  max_speed_mps: number | null;
  traversal_direction: FartlekCompletion["traversalDirection"] | null;
  fartlek_length_m_snapshot: number;
  fartlek_geometry_version_snapshot: number;
}

const mapCompletion = (row: CompletionRow): FartlekCompletion => ({
  id: row.id,
  fartlekId: row.fartlek_id,
  playerId: row.player_id,
  activityId: row.activity_id,
  completedAt: row.completed_at.toISOString(),
  elapsedTimeS: row.elapsed_time_s,
  averageSpeedMps: row.average_speed_mps,
  ...(row.max_speed_mps === null ? {} : { maxSpeedMps: row.max_speed_mps }),
  ...(row.traversal_direction === null ? {} : { traversalDirection: row.traversal_direction }),
  fartlekLengthMSnapshot: row.fartlek_length_m_snapshot,
  fartlekGeometryVersionSnapshot: row.fartlek_geometry_version_snapshot
});

export interface FartlekCompletionStatsForPlayer {
  completed: boolean;
  completionCount: number;
  bestElapsedTimeS?: number;
  latestCompletion?: FartlekCompletion;
}

export class FartlekCompletionRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Inserts completion drafts within an existing transaction (shared with activity persistence),
   * so Fartlek XP lands atomically with activity XP. The unique (activity_id, fartlek_id) index
   * makes reprocessing/replay of the same activity a safe no-op.
   */
  async insertManyWithClient(
    client: Pick<PoolClient, "query">,
    playerId: string,
    activityId: string,
    drafts: FartlekCompletionDraft[]
  ): Promise<void> {
    for (const draft of drafts) {
      await client.query(
        `INSERT INTO fartlek_completions (
          id, fartlek_id, player_id, activity_id, completed_at, elapsed_time_s, average_speed_mps,
          max_speed_mps, traversal_direction, fartlek_length_m_snapshot, fartlek_geometry_version_snapshot
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (activity_id, fartlek_id) DO NOTHING`,
        [
          randomUUID(),
          draft.fartlekId,
          playerId,
          activityId,
          new Date(draft.completedAtTimestampMs),
          draft.elapsedTimeS,
          draft.averageSpeedMps,
          draft.maxSpeedMps ?? null,
          draft.traversalDirection,
          draft.fartlekLengthMSnapshot,
          draft.fartlekGeometryVersionSnapshot
        ]
      );
    }
  }

  async listCompletionsForActivity(playerId: string, activityId: string): Promise<FartlekCompletion[]> {
    const result = await this.pool.query<CompletionRow>(
      `SELECT id, fartlek_id, player_id, activity_id, completed_at, elapsed_time_s, average_speed_mps,
              max_speed_mps, traversal_direction, fartlek_length_m_snapshot, fartlek_geometry_version_snapshot
       FROM fartlek_completions
       WHERE player_id = $1 AND activity_id = $2
       ORDER BY completed_at`,
      [playerId, activityId]
    );
    return result.rows.map(mapCompletion);
  }

  /** Per-Fartlek completion stats for one player, used to render World completion state. */
  async statsForPlayer(playerId: string, fartlekIds: string[]): Promise<Map<string, FartlekCompletionStatsForPlayer>> {
    const stats = new Map<string, FartlekCompletionStatsForPlayer>();
    if (fartlekIds.length === 0) return stats;
    const result = await this.pool.query<CompletionRow & { completion_count: string; best_elapsed_time_s: number }>(
      `SELECT DISTINCT ON (fartlek_id)
         fartlek_id, id, player_id, activity_id, completed_at, elapsed_time_s, average_speed_mps,
         max_speed_mps, traversal_direction, fartlek_length_m_snapshot, fartlek_geometry_version_snapshot,
         COUNT(*) OVER (PARTITION BY fartlek_id) AS completion_count,
         MIN(elapsed_time_s) OVER (PARTITION BY fartlek_id) AS best_elapsed_time_s
       FROM fartlek_completions
       WHERE player_id = $1 AND fartlek_id = ANY($2::text[])
       ORDER BY fartlek_id, completed_at DESC`,
      [playerId, fartlekIds]
    );
    for (const row of result.rows) {
      stats.set(row.fartlek_id, {
        completed: true,
        completionCount: Number(row.completion_count),
        bestElapsedTimeS: row.best_elapsed_time_s,
        latestCompletion: mapCompletion(row)
      });
    }
    return stats;
  }

  summaryFromCompletion(completion: FartlekCompletion): FartlekCompletionSummary {
    return {
      completedAt: completion.completedAt,
      elapsedTimeS: completion.elapsedTimeS,
      averageSpeedMps: completion.averageSpeedMps,
      ...(completion.maxSpeedMps === undefined ? {} : { maxSpeedMps: completion.maxSpeedMps })
    };
  }
}
