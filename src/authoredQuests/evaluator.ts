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

export type AuthoredQuestState = "completed" | "active" | "failed" | "available" | "locked";

/** Open or failed attempt of an authored quest, as persisted. */
export interface AuthoredQuestAttemptView {
  status: "active" | "failed";
  attemptCount: number;
  startedAt: string;
  failedAt?: string;
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
  attempt?: AuthoredQuestAttemptView;
  requiredNode?: { id: string; name: string; premium: boolean };
  requiredQuestTitle?: string;
  completedAt?: string;
}

export const buildAuthoredQuestViews = (
  unlockedNodeIds: ReadonlySet<string>,
  completedAtByQuestId: ReadonlyMap<string, string>,
  attemptsByQuestId: ReadonlyMap<string, AuthoredQuestAttemptView> = new Map()
): AuthoredQuestView[] => AUTHORED_QUEST_CHAINS.flatMap((chain) => {
  const node = findSkillTreeNode(chain.nodeId);
  const nodeUnlocked = unlockedNodeIds.has(chain.nodeId);
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
    if (completedAt) return { ...base, state: "completed", completedAt };
    if (!nodeUnlocked) {
      return {
        ...base,
        state: "locked",
        requiredNode: { id: chain.nodeId, name: node?.name ?? chain.nodeId, premium: node?.premium ?? false }
      };
    }
    if (previous && !completedAtByQuestId.has(previous.id)) {
      return { ...base, state: "locked", requiredQuestTitle: previous.title };
    }
    const attempt = attemptsByQuestId.get(quest.id);
    if (attempt) return { ...base, state: attempt.status, attempt };
    return { ...base, state: "available" };
  });
});
