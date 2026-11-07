import type { Pool, PoolClient } from "pg";
import type {
  Activity,
  ActivityResult,
  CollectibleCategory,
  NextQuestSuggestion,
  QuestCriterionResult,
  QuestOutcome
} from "../domain.js";
import { AUTHORED_QUEST_CHAINS, findAuthoredQuest } from "../authoredQuests/catalog.js";
import {
  buildAuthoredQuestViews,
  evaluateAuthoredQuestCriteria,
  nextAuthoredQuestAfter,
  type ActivityQuestMetrics,
  type AuthoredQuestFailureView,
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

const toNextSuggestion = (questId: string): NextQuestSuggestion | undefined => {
  const next = nextAuthoredQuestAfter(questId);
  if (!next) return undefined;
  const chain = AUTHORED_QUEST_CHAINS.find((candidate) => candidate.id === next.chainId);
  return {
    id: next.id,
    title: next.title,
    ...(chain ? { chainTitle: chain.title } : {}),
    difficulty: next.difficulty,
    xp: next.xp
  };
};

const unlockedAtByNodeId = async (client: PoolClient | Pool, playerId: string): Promise<Map<string, string>> => {
  const rows = await client.query<{ node_id: string; unlocked_at: Date }>(
    "SELECT node_id, unlocked_at FROM skill_tree_unlocks WHERE player_id = $1",
    [playerId]
  );
  return new Map(rows.rows.map((row) => [row.node_id, row.unlocked_at.toISOString()]));
};

const completedAtByQuestId = async (client: PoolClient | Pool, playerId: string): Promise<Map<string, string>> => {
  const rows = await client.query<{ quest_id: string; completed_at: Date }>(
    "SELECT quest_id, completed_at FROM authored_quest_completions WHERE player_id = $1",
    [playerId]
  );
  return new Map(rows.rows.map((row) => [row.quest_id, row.completed_at.toISOString()]));
};

/**
 * Resolves the active authored quests against one newly persisted activity inside its
 * transaction. Quests are active from the moment they become available (chain node unlocked and
 * previous step completed). An activity of the quest's sport that started after that moment either
 * completes the quest (XP granted exactly once) or records a failure; the quest then stays active
 * for the next activity. Earlier activities never count, except on DEV (`ignoreAvailabilityDate`),
 * where imported historic activities may resolve quests.
 */
export const resolveAuthoredQuestAttemptsWithClient = async (
  client: PoolClient,
  playerId: string,
  activityId: string,
  activityStartedAt: Date,
  metrics: ActivityQuestMetrics,
  ignoreAvailabilityDate = false
): Promise<QuestOutcome[]> => {
  const [unlocked, completed] = await Promise.all([
    unlockedAtByNodeId(client, playerId),
    completedAtByQuestId(client, playerId)
  ]);
  const outcomes: QuestOutcome[] = [];
  for (const view of buildAuthoredQuestViews(unlocked, completed)) {
    if (view.state !== "active") continue;
    if (!ignoreAvailabilityDate && Date.parse(view.availableSince!) > activityStartedAt.getTime()) continue;
    const quest = findAuthoredQuest(view.id);
    const chain = quest ? AUTHORED_QUEST_CHAINS.find((candidate) => candidate.id === quest.chainId) : undefined;
    if (!quest || !chain) continue;
    if (quest.criteria.sport !== undefined && quest.criteria.sport !== metrics.sport) continue;
    const criteria = evaluateAuthoredQuestCriteria(quest.criteria, metrics);
    const passed = criteria.every((result) => result.met);
    const base = { questId: quest.id, kind: "authored" as const, title: quest.title, chainTitle: chain.title, difficulty: quest.difficulty };
    if (passed) {
      const inserted = await client.query(
        `INSERT INTO authored_quest_completions (player_id, quest_id, activity_id, xp)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [playerId, quest.id, activityId, quest.xp]
      );
      await client.query("DELETE FROM authored_quest_attempts WHERE player_id = $1 AND quest_id = $2", [playerId, quest.id]);
      if (inserted.rowCount !== 1) continue;
      const next = toNextSuggestion(quest.id);
      outcomes.push({ ...base, result: "completed", xp: quest.xp, criteria, ...(next ? { next } : {}) });
    } else {
      await client.query(
        `INSERT INTO authored_quest_attempts (player_id, quest_id, status, attempt_count, failed_at, activity_id, result)
         VALUES ($1, $2, 'failed', 1, now(), $3, $4)
         ON CONFLICT (player_id, quest_id) DO UPDATE SET
           attempt_count = authored_quest_attempts.attempt_count + 1,
           failed_at = now(), activity_id = EXCLUDED.activity_id, result = EXCLUDED.result`,
        [playerId, quest.id, activityId, JSON.stringify({ criteria })]
      );
      outcomes.push({ ...base, result: "failed", xp: 0, criteria });
    }
  }
  return outcomes;
};

export class AuthoredQuestRepository {
  constructor(private readonly pool: Pool) {}

  async list(playerId: string): Promise<AuthoredQuestView[]> {
    const [unlocked, completed, failures, seen] = await Promise.all([
      unlockedAtByNodeId(this.pool, playerId),
      completedAtByQuestId(this.pool, playerId),
      this.pool.query<{
        quest_id: string;
        attempt_count: number;
        failed_at: Date;
        result: { criteria?: QuestCriterionResult[] } | null;
      }>(
        `SELECT quest_id, attempt_count, failed_at, result
         FROM authored_quest_attempts WHERE player_id = $1 AND status = 'failed'`,
        [playerId]
      ),
      this.pool.query<{ rewards_seen_at: Date | null }>("SELECT rewards_seen_at FROM players WHERE id = $1", [playerId])
    ]);
    return buildAuthoredQuestViews(
      unlocked,
      completed,
      new Map(failures.rows.map((row): [string, AuthoredQuestFailureView] => [row.quest_id, {
        attemptCount: row.attempt_count,
        failedAt: row.failed_at.toISOString(),
        ...(row.result?.criteria ? { criteria: row.result.criteria } : {})
      }])),
      seen.rows[0]?.rewards_seen_at?.toISOString()
    );
  }
}
