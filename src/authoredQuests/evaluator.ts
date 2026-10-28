import type { ActivityType, CollectibleCategory } from "../domain.js";
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

export const meetsAuthoredQuestCriteria = (criteria: AuthoredQuestCriteria, metrics: ActivityQuestMetrics): boolean =>
  (criteria.sport === undefined || criteria.sport === metrics.sport)
  && metrics.distanceKm >= (criteria.minDistanceKm ?? 0)
  && metrics.averageSpeedKmh >= (criteria.minAverageSpeedKmh ?? 0)
  && metrics.elevationGainM >= (criteria.minElevationGainM ?? 0)
  && metrics.collectibles >= (criteria.minCollectibles ?? 0)
  && metrics.flowlines >= (criteria.minFlowlines ?? 0)
  && (criteria.category === undefined
    || (metrics.categoryCounts[criteria.category] ?? 0) >= (criteria.minCategoryCollectibles ?? 0));

/**
 * The quests one activity completes. Only the first incomplete step of a chain whose unlocking Atlas
 * node is unlocked is available, so one activity advances each chain by at most one step and
 * nothing in a locked chain can complete.
 */
export const completableAuthoredQuests = (
  unlockedNodeIds: ReadonlySet<string>,
  completedQuestIds: ReadonlySet<string>,
  metrics: ActivityQuestMetrics
): AuthoredQuest[] => {
  const completable: AuthoredQuest[] = [];
  for (const chain of AUTHORED_QUEST_CHAINS) {
    if (!unlockedNodeIds.has(chain.nodeId)) continue;
    const next = chain.quests.find((quest) => !completedQuestIds.has(quest.id));
    if (next && meetsAuthoredQuestCriteria(next.criteria, metrics)) completable.push(next);
  }
  return completable;
};

export type AuthoredQuestState = "completed" | "available" | "locked";

export interface AuthoredQuestView {
  id: string;
  chainId: string;
  chainTitle: string;
  step: number;
  totalSteps: number;
  title: string;
  description: string;
  xp: number;
  state: AuthoredQuestState;
  requiredNode?: { id: string; name: string; premium: boolean };
  requiredQuestTitle?: string;
  completedAt?: string;
}

export const buildAuthoredQuestViews = (
  unlockedNodeIds: ReadonlySet<string>,
  completedAtByQuestId: ReadonlyMap<string, string>
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
    return { ...base, state: "available" };
  });
});
