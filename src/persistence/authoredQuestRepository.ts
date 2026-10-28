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
  type AuthoredQuestAttemptView,
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

export class AuthoredQuestNotFoundError extends Error {
  constructor() {
    super("Quest not found.");
  }
}

export class AuthoredQuestStateError extends Error {}

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

/**
 * Resolves the open authored quest attempts against one newly persisted activity inside its
 * transaction. A quest is a one-activity attempt: the first activity that started after the attempt
 * began either completes it (XP granted exactly once) or fails it (retry required). Attempts that
 * started after the activity began are left untouched. Never looks at earlier activities.
 */
export const resolveAuthoredQuestAttemptsWithClient = async (
  client: PoolClient,
  playerId: string,
  activityId: string,
  activityStartedAt: Date,
  metrics: ActivityQuestMetrics
): Promise<QuestOutcome[]> => {
  const attempts = await client.query<{ quest_id: string }>(
    `SELECT quest_id FROM authored_quest_attempts
     WHERE player_id = $1 AND status = 'active' AND started_at <= $2
     ORDER BY started_at, quest_id`,
    [playerId, activityStartedAt]
  );
  if (attempts.rowCount === 0) return [];
  const unlocked = await unlockedNodeIds(client, playerId);
  const outcomes: QuestOutcome[] = [];
  for (const { quest_id: questId } of attempts.rows) {
    const quest = findAuthoredQuest(questId);
    const chain = quest ? AUTHORED_QUEST_CHAINS.find((candidate) => candidate.id === quest.chainId) : undefined;
    if (!quest || !chain || !unlocked.has(chain.nodeId)) continue;
    const criteria = evaluateAuthoredQuestCriteria(quest.criteria, metrics);
    const passed = criteria.every((result) => result.met);
    const base = { questId, kind: "authored" as const, title: quest.title, chainTitle: chain.title, difficulty: quest.difficulty };
    if (passed) {
      const inserted = await client.query(
        `INSERT INTO authored_quest_completions (player_id, quest_id, activity_id, xp)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [playerId, quest.id, activityId, quest.xp]
      );
      await client.query("DELETE FROM authored_quest_attempts WHERE player_id = $1 AND quest_id = $2", [playerId, questId]);
      if (inserted.rowCount !== 1) continue;
      const next = toNextSuggestion(questId);
      outcomes.push({ ...base, result: "completed", xp: quest.xp, criteria, ...(next ? { next } : {}) });
    } else {
      await client.query(
        `UPDATE authored_quest_attempts
         SET status = 'failed', failed_at = now(), activity_id = $3, result = $4
         WHERE player_id = $1 AND quest_id = $2`,
        [playerId, questId, activityId, JSON.stringify({ criteria })]
      );
      outcomes.push({ ...base, result: "failed", xp: 0, criteria });
    }
  }
  return outcomes;
};

export class AuthoredQuestRepository {
  constructor(private readonly pool: Pool) {}

  async list(playerId: string): Promise<AuthoredQuestView[]> {
    const unlocked = await unlockedNodeIds(this.pool, playerId);
    const [completed, attempts] = await Promise.all([
      this.pool.query<{ quest_id: string; completed_at: Date }>(
        "SELECT quest_id, completed_at FROM authored_quest_completions WHERE player_id = $1",
        [playerId]
      ),
      this.pool.query<{
        quest_id: string;
        status: "active" | "failed";
        attempt_count: number;
        started_at: Date;
        failed_at: Date | null;
        result: { criteria?: QuestCriterionResult[] } | null;
      }>(
        `SELECT quest_id, status, attempt_count, started_at, failed_at, result
         FROM authored_quest_attempts WHERE player_id = $1`,
        [playerId]
      )
    ]);
    return buildAuthoredQuestViews(
      unlocked,
      new Map(completed.rows.map((row) => [row.quest_id, row.completed_at.toISOString()])),
      new Map(attempts.rows.map((row): [string, AuthoredQuestAttemptView] => [row.quest_id, {
        status: row.status,
        attemptCount: row.attempt_count,
        startedAt: row.started_at.toISOString(),
        ...(row.failed_at ? { failedAt: row.failed_at.toISOString() } : {}),
        ...(row.result?.criteria ? { criteria: row.result.criteria } : {})
      }]))
    );
  }

  /** Starts (or retries after a failure) the one-activity attempt for an available quest step. */
  async start(playerId: string, questId: string, startedAt: Date = new Date()): Promise<void> {
    const quest = findAuthoredQuest(questId);
    const chain = quest ? AUTHORED_QUEST_CHAINS.find((candidate) => candidate.id === quest.chainId) : undefined;
    if (!quest || !chain) throw new AuthoredQuestNotFoundError();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const player = await client.query("SELECT id FROM players WHERE id = $1 FOR UPDATE", [playerId]);
      if (player.rowCount !== 1) throw new AuthoredQuestNotFoundError();
      const unlocked = await unlockedNodeIds(client, playerId);
      if (!unlocked.has(chain.nodeId)) throw new AuthoredQuestStateError("Unlock this quest chain in the Skill Atlas first.");
      const completed = await client.query<{ quest_id: string }>(
        "SELECT quest_id FROM authored_quest_completions WHERE player_id = $1 AND quest_id = ANY($2::text[])",
        [playerId, chain.quests.map((step) => step.id)]
      );
      const done = new Set(completed.rows.map((row) => row.quest_id));
      if (done.has(questId)) throw new AuthoredQuestStateError("This quest is already completed.");
      const previous = chain.quests[quest.step - 2];
      if (previous && !done.has(previous.id)) throw new AuthoredQuestStateError("Complete the previous quest first.");
      const existing = await client.query<{ status: "active" | "failed" }>(
        "SELECT status FROM authored_quest_attempts WHERE player_id = $1 AND quest_id = $2",
        [playerId, questId]
      );
      if (existing.rows[0]?.status === "active") throw new AuthoredQuestStateError("This quest is already active.");
      await client.query(
        `INSERT INTO authored_quest_attempts (player_id, quest_id, status, attempt_count, started_at)
         VALUES ($1, $2, 'active', 1, $3)
         ON CONFLICT (player_id, quest_id) DO UPDATE SET
           status = 'active', attempt_count = authored_quest_attempts.attempt_count + 1,
           started_at = EXCLUDED.started_at, failed_at = NULL, activity_id = NULL, result = NULL`,
        [playerId, questId, startedAt]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
