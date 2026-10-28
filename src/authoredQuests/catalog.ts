import type { ActivityType, CollectibleCategory, QuestDifficulty } from "../domain.js";
import { QUEST_XP_BY_DIFFICULTY } from "../questObjectives.js";
import { SKILL_TREE_NODES } from "../skillTree/catalog.js";
import type { SkillTreeNode } from "../skillTree/types.js";

/**
 * What one single activity must achieve to complete an authored quest step. Every field that is
 * set must hold for the same activity.
 */
export interface AuthoredQuestCriteria {
  /** Sport the activity must have; omitted means any sport. */
  sport?: Exclude<ActivityType, "unknown" | "walking">;
  minDistanceKm?: number;
  /** Distinct collectibles collected during the activity. */
  minCollectibles?: number;
  category?: CollectibleCategory;
  /** Distinct collectibles of `category` collected during the activity. */
  minCategoryCollectibles?: number;
  minFlowlines?: number;
  minElevationGainM?: number;
  minAverageSpeedKmh?: number;
}

export interface AuthoredQuest {
  id: string;
  chainId: string;
  /** 1-based position in the chain; a step becomes available once the previous one is complete. */
  step: number;
  title: string;
  description: string;
  difficulty: QuestDifficulty;
  /** Bonus XP granted once on completion; fixed by difficulty. */
  xp: number;
  criteria: AuthoredQuestCriteria;
}

export interface AuthoredQuestChain {
  /** Equals the `quest_unlock` grant value that unlocks the chain. */
  id: string;
  title: string;
  /** The Skill Atlas node whose unlock makes the chain available. */
  nodeId: string;
  quests: AuthoredQuest[];
}

/** Quest steps per unlocking Atlas node, in chain order. */
const CHAIN_STEPS: Record<string, AuthoredQuestCriteria[]> = {
  // Cycling
  "rusher-i": [{ sport: "cycling", minFlowlines: 1 }, { sport: "cycling", minFlowlines: 3 }],
  "flow-hunter": [{ sport: "cycling", minFlowlines: 4 }, { sport: "cycling", minFlowlines: 6 }],
  "cycling-breakaway-rider": [
    { sport: "cycling", minFlowlines: 6, minDistanceKm: 40 },
    { sport: "cycling", minFlowlines: 8, minDistanceKm: 60 }
  ],
  "adventurer-i": [{ sport: "cycling", minCollectibles: 2 }, { sport: "cycling", minCollectibles: 4 }],
  "explorer": [{ sport: "cycling", minCollectibles: 5 }, { sport: "cycling", minCollectibles: 8 }],
  "grand-explorer": [{ sport: "cycling", minCollectibles: 10 }, { sport: "cycling", minCollectibles: 15 }],
  "endurance-i": [{ sport: "cycling", minDistanceKm: 30 }, { sport: "cycling", minDistanceKm: 50 }],
  "fondo": [{ sport: "cycling", minDistanceKm: 80 }, { sport: "cycling", minDistanceKm: 100 }],
  "cycling-climber": [{ sport: "cycling", minElevationGainM: 800 }, { sport: "cycling", minElevationGainM: 1500 }],
  "cycling-fast-explorer": [
    { sport: "cycling", minFlowlines: 2, minCollectibles: 2 },
    { sport: "cycling", minFlowlines: 4, minCollectibles: 4 }
  ],
  "cycling-adventure-endurance": [
    { sport: "cycling", minCollectibles: 3, minDistanceKm: 40 },
    { sport: "cycling", minCollectibles: 5, minDistanceKm: 60 }
  ],
  "breakaway-specialist": [
    { sport: "cycling", minFlowlines: 3, minDistanceKm: 50 },
    { sport: "cycling", minFlowlines: 5, minDistanceKm: 70 }
  ],
  // Running
  "run-speed-1": [
    { sport: "running", minDistanceKm: 3, minAverageSpeedKmh: 8 },
    { sport: "running", minDistanceKm: 5, minAverageSpeedKmh: 9 }
  ],
  "run-speed-2": [
    { sport: "running", minDistanceKm: 5, minAverageSpeedKmh: 10 },
    { sport: "running", minDistanceKm: 8, minAverageSpeedKmh: 11 }
  ],
  "run-speed-3": [
    { sport: "running", minDistanceKm: 5, minAverageSpeedKmh: 11 },
    { sport: "running", minDistanceKm: 8, minAverageSpeedKmh: 12 }
  ],
  "run-speed-4": [
    { sport: "running", minDistanceKm: 10, minAverageSpeedKmh: 10.5 },
    { sport: "running", minDistanceKm: 10, minAverageSpeedKmh: 11.5 }
  ],
  "run-explore-1": [{ sport: "running", minCollectibles: 1 }, { sport: "running", minCollectibles: 3 }],
  "run-explore-2": [
    { sport: "running", minCollectibles: 3, minDistanceKm: 5 },
    { sport: "running", minCollectibles: 5, minDistanceKm: 8 }
  ],
  "run-explore-3": [
    { sport: "running", category: "viewpoint", minCategoryCollectibles: 2 },
    { sport: "running", category: "viewpoint", minCategoryCollectibles: 4 }
  ],
  "run-explore-4": [{ sport: "running", minCollectibles: 5 }, { sport: "running", minCollectibles: 8 }],
  "run-endurance-1": [{ sport: "running", minDistanceKm: 5 }, { sport: "running", minDistanceKm: 8 }],
  "run-endurance-2": [{ sport: "running", minDistanceKm: 10 }, { sport: "running", minDistanceKm: 12 }],
  "run-endurance-3": [{ sport: "running", minDistanceKm: 21 }, { sport: "running", minDistanceKm: 25 }],
  "run-endurance-4": [{ sport: "running", minDistanceKm: 25 }, { sport: "running", minDistanceKm: 30 }],
  "run-fast-explorer": [
    { sport: "running", minDistanceKm: 5, minAverageSpeedKmh: 10, minCollectibles: 2 },
    { sport: "running", minDistanceKm: 8, minAverageSpeedKmh: 11, minCollectibles: 4 }
  ],
  "run-trail-endurance": [
    { sport: "running", minDistanceKm: 12, minCollectibles: 3 },
    { sport: "running", minDistanceKm: 15, minCollectibles: 5 }
  ],
  "run-strong-finisher": [
    { sport: "running", minDistanceKm: 10, minAverageSpeedKmh: 10.5 },
    { sport: "running", minDistanceKm: 15, minAverageSpeedKmh: 11 }
  ],
  // Hiking
  "hike-summit-1": [
    { sport: "hiking", category: "peak", minCategoryCollectibles: 1 },
    { sport: "hiking", category: "peak", minCategoryCollectibles: 2 }
  ],
  "hike-summit-3": [
    { sport: "hiking", category: "peak", minCategoryCollectibles: 3 },
    { sport: "hiking", category: "peak", minCategoryCollectibles: 4 }
  ],
  "hike-summit-4": [
    { sport: "hiking", category: "mountain_pass", minCategoryCollectibles: 1 },
    { sport: "hiking", category: "mountain_pass", minCategoryCollectibles: 2 }
  ],
  "hike-summit-5": [
    { sport: "hiking", category: "peak", minCategoryCollectibles: 4, minElevationGainM: 800 },
    { sport: "hiking", category: "peak", minCategoryCollectibles: 5, minElevationGainM: 1200 }
  ],
  "hike-explore-1": [{ sport: "hiking", minCollectibles: 2 }, { sport: "hiking", minCollectibles: 4 }],
  "hike-pathfinder": [
    { sport: "hiking", minCollectibles: 4, minDistanceKm: 8 },
    { sport: "hiking", minCollectibles: 6, minDistanceKm: 12 }
  ],
  "hike-landmark-seeker": [
    { sport: "hiking", category: "place", minCategoryCollectibles: 3 },
    { sport: "hiking", category: "place", minCategoryCollectibles: 5 }
  ],
  "hike-wilderness-explorer": [{ sport: "hiking", minCollectibles: 6 }, { sport: "hiking", minCollectibles: 10 }],
  "hike-endurance-1": [{ sport: "hiking", minDistanceKm: 8 }, { sport: "hiking", minDistanceKm: 12 }],
  "hike-distance-hiker": [{ sport: "hiking", minDistanceKm: 15 }, { sport: "hiking", minDistanceKm: 20 }],
  "hike-long-trail": [{ sport: "hiking", minDistanceKm: 20 }, { sport: "hiking", minDistanceKm: 25 }],
  "hike-elevation-hunter": [{ sport: "hiking", minElevationGainM: 600 }, { sport: "hiking", minElevationGainM: 1000 }],
  "hike-mountain-explorer": [
    { sport: "hiking", category: "peak", minCategoryCollectibles: 2, minCollectibles: 4 },
    { sport: "hiking", category: "peak", minCategoryCollectibles: 3, minCollectibles: 6 }
  ],
  "hike-alpine-endurance": [
    { sport: "hiking", minElevationGainM: 800, minDistanceKm: 15 },
    { sport: "hiking", minElevationGainM: 1200, minDistanceKm: 20 }
  ],
  "hike-long-distance-explorer": [
    { sport: "hiking", minDistanceKm: 20, minCollectibles: 4 },
    { sport: "hiking", minDistanceKm: 25, minCollectibles: 6 }
  ],
  // Cross-sport chains alternate sports, so each step names the sport it needs.
  "xs-weekend-warrior": [{ sport: "cycling", minDistanceKm: 30 }, { sport: "running", minDistanceKm: 5 }],
  "xs-dual-athlete": [{ sport: "cycling", minDistanceKm: 40 }, { sport: "running", minDistanceKm: 10 }],
  "xs-bike-hike-explorer": [{ sport: "cycling", minCollectibles: 3 }, { sport: "hiking", minCollectibles: 3 }],
  "xs-run-hike-explorer": [{ sport: "running", minCollectibles: 3 }, { sport: "hiking", minCollectibles: 3 }],
  "xs-endurance-hybrid": [
    { sport: "cycling", minDistanceKm: 60 },
    { sport: "running", minDistanceKm: 15 },
    { sport: "hiking", minDistanceKm: 20 }
  ],
  "xs-multi-sport-explorer": [{ minCollectibles: 5 }, { minCollectibles: 8 }, { minCollectibles: 12 }]
};

export { QUEST_XP_BY_DIFFICULTY };

const DIFFICULTY_BY_TIER: Record<string, QuestDifficulty> = { "1": "easy", "2": "medium", "3": "hard", prestige: "prestige" };

const ROMAN = ["I", "II", "III", "IV"];

const SPORT_NOUN: Record<string, string> = { cycling: "ride", running: "run", hiking: "hike" };

export const describeAuthoredQuestCriteria = (criteria: AuthoredQuestCriteria): string => {
  const noun = criteria.sport ? SPORT_NOUN[criteria.sport] : "activity";
  const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (criteria.minDistanceKm !== undefined) parts.push(`cover ${criteria.minDistanceKm} km`);
  if (criteria.minAverageSpeedKmh !== undefined) parts.push(`average ${criteria.minAverageSpeedKmh} km/h`);
  if (criteria.minElevationGainM !== undefined) parts.push(`climb ${criteria.minElevationGainM} m`);
  if (criteria.minFlowlines !== undefined) parts.push(`complete ${plural(criteria.minFlowlines, "Flowline")}`);
  if (criteria.minCollectibles !== undefined) parts.push(`collect ${plural(criteria.minCollectibles, "collectible")}`);
  if (criteria.minCategoryCollectibles !== undefined && criteria.category) {
    parts.push(`collect ${plural(criteria.minCategoryCollectibles, criteria.category.replace("_", " "))}`);
  }
  return `In a single ${noun}: ${parts.join(", ")}.`;
};

const buildChain = (node: SkillTreeNode, steps: AuthoredQuestCriteria[]): AuthoredQuestChain => {
  const label = node.grant.label.replace(/^Unlocks\s+/i, "");
  const title = label.charAt(0).toUpperCase() + label.slice(1);
  const difficulty = DIFFICULTY_BY_TIER[String(node.tier)] ?? "medium";
  return {
    id: node.grant.value,
    title,
    nodeId: node.id,
    quests: steps.map((criteria, index) => ({
      id: `${node.grant.value}:${index + 1}`,
      chainId: node.grant.value,
      step: index + 1,
      title: `${title} ${ROMAN[index] ?? index + 1}`,
      description: describeAuthoredQuestCriteria(criteria),
      difficulty,
      xp: QUEST_XP_BY_DIFFICULTY[difficulty],
      criteria
    }))
  };
};

/** Every `quest_unlock` Atlas grant unlocks exactly one authored chain. */
export const AUTHORED_QUEST_CHAINS: readonly AuthoredQuestChain[] = SKILL_TREE_NODES
  .filter((node) => node.grant.type === "quest_unlock")
  .map((node) => {
    const steps = CHAIN_STEPS[node.id];
    if (!steps || steps.length === 0) throw new Error(`Atlas node ${node.id} grants quests but has no authored chain.`);
    return buildChain(node, steps);
  });

const QUESTS_BY_ID = new Map(
  AUTHORED_QUEST_CHAINS.flatMap((chain) => chain.quests.map((quest) => [quest.id, quest] as const))
);

export const findAuthoredQuest = (questId: string): AuthoredQuest | undefined => QUESTS_BY_ID.get(questId);

/** Authored quest chains unlocked by one Atlas node (empty unless it grants `quest_unlock`). */
export const authoredQuestChainsForNode = (nodeId: string): AuthoredQuestChain[] =>
  AUTHORED_QUEST_CHAINS.filter((chain) => chain.nodeId === nodeId);
