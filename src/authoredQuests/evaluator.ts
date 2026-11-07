import type { ActivityType, CollectibleCategory, QuestCriterionResult, QuestDifficulty } from "../domain.js";
import { findSkillTreeNode } from "../skillTree/catalog.js";
import {
  AUTHORED_QUEST_CHAINS,
  type AuthoredQuest,
  type AuthoredQuestCriteria
} from "./catalog.js";

/** What one activity achieved, evaluated against authored quest steps. */
export interface ActivityQuestMetrics {
  sport: ActivityType;
  distanceKm: number;
  averageSpeedKmh: number;
  elevationGainM: number;
  /** Distinct collectibles collected during the activity. */
  collectibles: number;
  categoryCounts: Partial<Record<CollectibleCategory, number>>;
  /** Distinct Flowlines completed during the activity. */
  flowlines: number;
}

const SPORT_LABEL: Record<string, string> = { cycling: "ride", running: "run", hiking: "hike" };

/** Per-criterion results for one activity, so a failed attempt can show exactly what fell short. */
export const evaluateAuthoredQuestCriteria = (
  criteria: AuthoredQuestCriteria,
  metrics: ActivityQuestMetrics
): QuestCriterionResult[] => {
  const results: QuestCriterionResult[] = [];
  if (criteria.sport !== undefined) {
    results.push({
      label: `Activity type: ${SPORT_LABEL[criteria.sport] ?? criteria.sport}`,
      current: metrics.sport === criteria.sport ? 1 : 0,
      required: 1,
      met: metrics.sport === criteria.sport
    });
  }
  const numeric = (label: string, current: number, required: number | undefined, unit?: string): void => {
    if (required === undefined) return;
    const rounded = Math.round(current * 10) / 10;
    results.push({ label, current: rounded, required, met: current >= required, ...(unit ? { unit } : {}) });
  };
  numeric("Distance", metrics.distanceKm, criteria.minDistanceKm, "km");
  numeric("Average speed", metrics.averageSpeedKmh, criteria.minAverageSpeedKmh, "km/h");
  numeric("Elevation gain", metrics.elevationGainM, criteria.minElevationGainM, "m");
  numeric("Flowlines", metrics.flowlines, criteria.minFlowlines);
  numeric("Collectibles", metrics.collectibles, criteria.minCollectibles);
  if (criteria.category !== undefined) {
    numeric(
      `Collectibles: ${criteria.category.replace("_", " ")}`,
      metrics.categoryCounts[criteria.category] ?? 0,
      criteria.minCategoryCollectibles ?? 0
    );
  }
  return results;
};

export const meetsAuthoredQuestCriteria = (criteria: AuthoredQuestCriteria, metrics: ActivityQuestMetrics): boolean =>
  evaluateAuthoredQuestCriteria(criteria, metrics).every((result) => result.met);

/** The step after `questId` in its chain, if any. */
export const nextAuthoredQuestAfter = (questId: string): AuthoredQuest | undefined => {
  for (const chain of AUTHORED_QUEST_CHAINS) {
    const index = chain.quests.findIndex((quest) => quest.id === questId);
    if (index >= 0) return chain.quests[index + 1];
  }
  return undefined;
};

export type AuthoredQuestState = "completed" | "active" | "locked";

/** The most recent activity that fell short of an active quest; the quest stays active afterwards. */
export interface AuthoredQuestFailureView {
  attemptCount: number;
  failedAt: string;
  criteria?: QuestCriterionResult[];
}

export interface AuthoredQuestView {
  id: string;
  chainId: string;
  chainTitle: string;
  step: number;
  totalSteps: number;
  title: string;
  description: string;
  difficulty: QuestDifficulty;
  xp: number;
  state: AuthoredQuestState;
  /** Active quests only: only activities that started at or after this instant can resolve the quest. */
  availableSince?: string;
  /** Active or newly completed quests: true until the player has opened Progress. */
  isNew?: boolean;
  lastFailure?: AuthoredQuestFailureView;
  requiredNode?: { id: string; name: string; premium: boolean };
  requiredQuestTitle?: string;
  completedAt?: string;
}

/**
 * A quest is active as soon as its chain node is unlocked and the previous step is completed.
 * It becomes available at the later of those two moments.
 */
export const buildAuthoredQuestViews = (
  unlockedAtByNodeId: ReadonlyMap<string, string>,
  completedAtByQuestId: ReadonlyMap<string, string>,
  failuresByQuestId: ReadonlyMap<string, AuthoredQuestFailureView> = new Map(),
  rewardsSeenAt?: string
): AuthoredQuestView[] => AUTHORED_QUEST_CHAINS.flatMap((chain) => {
  const node = findSkillTreeNode(chain.nodeId);
  const nodeUnlockedAt = unlockedAtByNodeId.get(chain.nodeId);
  return chain.quests.map((quest, index): AuthoredQuestView => {
    const completedAt = completedAtByQuestId.get(quest.id);
    const previous = index > 0 ? chain.quests[index - 1] : undefined;
    const base = {
      id: quest.id,
      chainId: chain.id,
      chainTitle: chain.title,
      step: quest.step,
      totalSteps: chain.quests.length,
      title: quest.title,
      description: quest.description,
      difficulty: quest.difficulty,
      xp: quest.xp
    };
    if (completedAt) {
      return {
        ...base,
        state: "completed",
        completedAt,
        isNew: rewardsSeenAt === undefined || Date.parse(completedAt) > Date.parse(rewardsSeenAt)
      };
    }
    if (nodeUnlockedAt === undefined) {
      return {
        ...base,
        state: "locked",
        requiredNode: { id: chain.nodeId, name: node?.name ?? chain.nodeId, premium: node?.premium ?? false }
      };
    }
    const previousCompletedAt = previous ? completedAtByQuestId.get(previous.id) : undefined;
    if (previous && previousCompletedAt === undefined) return { ...base, state: "locked", requiredQuestTitle: previous.title };
    const availableSince = previousCompletedAt && Date.parse(previousCompletedAt) > Date.parse(nodeUnlockedAt)
      ? previousCompletedAt
      : nodeUnlockedAt;
    const lastFailure = failuresByQuestId.get(quest.id);
    return {
      ...base,
      state: "active",
      availableSince,
      isNew: rewardsSeenAt === undefined || Date.parse(availableSince) > Date.parse(rewardsSeenAt),
      ...(lastFailure ? { lastFailure } : {})
    };
  });
});
