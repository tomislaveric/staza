import type { Pool, PoolClient } from "pg";
import type { Activity, ActivityResult, CollectibleCategory } from "../domain.js";
import {
  buildAuthoredQuestViews,
  completableAuthoredQuests,
  type ActivityQuestMetrics,
  type AuthoredQuestView
} from "../authoredQuests/evaluator.js";

export const buildActivityQuestMetrics = (
  activity: Activity,
  result: ActivityResult,
  categoriesBySourceId: ReadonlyMap<string, CollectibleCategory | null>
): ActivityQuestMetrics => {
  const collected = new Set(result.events.map((event) => event.sourceId));
  const categoryCounts: Partial<Record<CollectibleCategory, number>> = {};
  for (const sourceId of collected) {
    const category = categoriesBySourceId.get(sourceId);
    if (category) categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
  }
  const distanceKm = (activity.distance ?? 0) / 1000;
  const duration = activity.duration ?? 0;
  return {
    sport: activity.type,
    distanceKm,
    averageSpeedKmh: duration > 0 ? distanceKm / (duration / 3600) : 0,
    elevationGainM: activity.elevationGainM ?? 0,
    collectibles: collected.size,
    categoryCounts,
    flowlines: new Set(result.fartlekCompletions.map((completion) => completion.fartlekId)).size
  };
};

const unlockedNodeIds = async (client: PoolClient | Pool, playerId: string): Promise<Set<string>> => {
  const rows = await client.query<{ node_id: string }>(
    "SELECT node_id FROM skill_tree_unlocks WHERE player_id = $1",
    [playerId]
  );
  return new Set(rows.rows.map((row) => row.node_id));
};

/**
 * Completes authored quest steps for a newly persisted activity inside its transaction and awards
 * their XP. Quests never look at earlier activities, so unlocking a node grants no retroactive progress.
 * Returns the XP awarded.
 */
export const completeAuthoredQuestsWithClient = async (
  client: PoolClient,
  playerId: string,
  activityId: string,
  metrics: ActivityQuestMetrics
): Promise<number> => {
  const unlocked = await unlockedNodeIds(client, playerId);
  if (unlocked.size === 0) return 0;
  const completed = await client.query<{ quest_id: string }>(
    "SELECT quest_id FROM authored_quest_completions WHERE player_id = $1",
    [playerId]
  );
  const quests = completableAuthoredQuests(unlocked, new Set(completed.rows.map((row) => row.quest_id)), metrics);
  let xp = 0;
  for (const quest of quests) {
    const inserted = await client.query(
      `INSERT INTO authored_quest_completions (player_id, quest_id, activity_id, xp)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [playerId, quest.id, activityId, quest.xp]
    );
    if (inserted.rowCount === 1) xp += quest.xp;
  }
  return xp;
};

export class AuthoredQuestRepository {
  constructor(private readonly pool: Pool) {}

  async list(playerId: string): Promise<AuthoredQuestView[]> {
    const unlocked = await unlockedNodeIds(this.pool, playerId);
    const completed = await this.pool.query<{ quest_id: string; completed_at: Date }>(
      "SELECT quest_id, completed_at FROM authored_quest_completions WHERE player_id = $1",
      [playerId]
    );
    return buildAuthoredQuestViews(
      unlocked,
      new Map(completed.rows.map((row) => [row.quest_id, row.completed_at.toISOString()]))
    );
  }
}
