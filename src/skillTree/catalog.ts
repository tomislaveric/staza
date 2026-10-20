import type { SkillTreeNode } from "./types.js";

/**
 * Player levels that grant one Skill Point each. Early points arrive quickly so
 * players make decisions soon; later points become scarcer and more valuable.
 * Roughly ten Skill Points are earned by level 30, then one every four levels.
 */
export const SKILL_POINT_AWARD_LEVELS: readonly number[] = [
  1, 3, 5, 8, 11, 14, 18, 22, 26, 30
];

const SKILL_POINT_INTERVAL_AFTER_30 = 4;

/**
 * Deterministic Skill Points earned for a reached player level. Earned points
 * are never a mutable counter; they are always derived from durable progress.
 */
export const earnedSkillPointsForLevel = (level: number): number => {
  if (!Number.isFinite(level) || level < 1) return 0;
  const flooredLevel = Math.floor(level);
  let earned = SKILL_POINT_AWARD_LEVELS.filter((awardLevel) => awardLevel <= flooredLevel).length;
  const lastAward = SKILL_POINT_AWARD_LEVELS[SKILL_POINT_AWARD_LEVELS.length - 1];
  if (flooredLevel > lastAward) {
    earned += Math.floor((flooredLevel - lastAward) / SKILL_POINT_INTERVAL_AFTER_30);
  }
  return earned;
};

const node = (definition: SkillTreeNode): SkillTreeNode => definition;

/**
 * Versioned static Skill Tree catalog. The database stores only the player's
 * chosen unlocks; the node definitions live here like the collectible and quest
 * templates. v1 ships the full Cycling tree; Running and cross-sport nodes are
 * introduced later.
 */
export const SKILL_TREE_NODES: readonly SkillTreeNode[] = [
  node({
    id: "cyclist",
    name: "Cyclist",
    description: "Begin your cycling journey and open the three specializations.",
    sport: "cycling",
    branch: "root",
    tier: 1,
    cost: 1,
    premium: false,
    requirements: [{ metric: "activityCount", target: 1, label: "Activities completed" }],
    prerequisites: [],
    grant: { type: "tree_access", value: "cycling-branches", label: "Unlocks the cycling branches" },
    layout: { col: 1, row: 0 }
  }),

  // Rush branch
  node({
    id: "rusher-i",
    name: "Rusher I",
    description: "Reward fast, flowing riding and open the Rush path.",
    sport: "cycling",
    branch: "rush",
    tier: 1,
    cost: 1,
    premium: false,
    requirements: [{ metric: "flowlines", target: 3, label: "Flowlines" }],
    prerequisites: ["cyclist"],
    grant: { type: "quest_unlock", value: "flow-quests", label: "Unlocks Flow quests" },
    layout: { col: 0, row: 1 }
  }),
  node({
    id: "rusher-ii",
    name: "Rusher II",
    description: "Sharpen your flow and reveal high-flow routes on the map.",
    sport: "cycling",
    branch: "rush",
    tier: 2,
    cost: 2,
    premium: true,
    requirements: [{ metric: "flowlines", target: 10, label: "Flowlines" }],
    prerequisites: ["rusher-i"],
    grant: { type: "world_filter", value: "high-flow", label: "Unlocks the High Flow map filter" },
    layout: { col: 0, row: 2 }
  }),
  node({
    id: "flow-hunter",
    name: "Flow Hunter",
    description: "Chain flowlines together across many rides.",
    sport: "cycling",
    branch: "rush",
    tier: 2,
    cost: 2,
    premium: true,
    requirements: [{ metric: "flowlines", target: 20, label: "Flowlines" }],
    prerequisites: ["rusher-ii"],
    grant: { type: "quest_unlock", value: "flow-hunter-quests", label: "Unlocks Flow Hunter quests" },
    layout: { col: 0, row: 3 }
  }),
  node({
    id: "flow-specialist",
    name: "Flow Specialist",
    description: "Master the flow discipline.",
    sport: "cycling",
    branch: "rush",
    tier: 3,
    cost: 2,
    premium: true,
    requirements: [{ metric: "flowlines", target: 35, label: "Flowlines" }],
    prerequisites: ["flow-hunter"],
    grant: { type: "title", value: "flow-specialist", label: "Earns the Flow Specialist title" },
    layout: { col: 0, row: 4 }
  }),

  // Adventure branch
  node({
    id: "adventurer-i",
    name: "Adventurer I",
    description: "Reward discovery and open the Adventure path.",
    sport: "cycling",
    branch: "adventure",
    tier: 1,
    cost: 1,
    premium: false,
    requirements: [{ metric: "places", target: 3, label: "Places" }],
    prerequisites: ["cyclist"],
    grant: { type: "quest_unlock", value: "explore-quests", label: "Unlocks Explore quests" },
    layout: { col: 1, row: 1 }
  }),
  node({
    id: "pathfinder",
    name: "Pathfinder",
    description: "Seek out the places no one has found yet.",
    sport: "cycling",
    branch: "adventure",
    tier: 2,
    cost: 2,
    premium: true,
    requirements: [{ metric: "places", target: 8, label: "Places" }],
    prerequisites: ["adventurer-i"],
    grant: { type: "world_filter", value: "undiscovered-only", label: "Unlocks the Undiscovered Only filter" },
    layout: { col: 1, row: 2 }
  }),
  node({
    id: "explorer",
    name: "Explorer",
    description: "Discover a wide variety of collectibles.",
    sport: "cycling",
    branch: "adventure",
    tier: 2,
    cost: 2,
    premium: true,
    requirements: [{ metric: "uniqueCollectibles", target: 20, label: "Unique discoveries" }],
    prerequisites: ["pathfinder"],
    grant: { type: "quest_unlock", value: "explorer-quests", label: "Unlocks Explorer quests" },
    layout: { col: 1, row: 3 }
  }),
  node({
    id: "world-seeker",
    name: "World Seeker",
    description: "Master exploration across the world.",
    sport: "cycling",
    branch: "adventure",
    tier: 3,
    cost: 2,
    premium: true,
    requirements: [{ metric: "viewpoints", target: 10, label: "Viewpoints" }],
    prerequisites: ["explorer"],
    grant: { type: "title", value: "world-seeker", label: "Earns the World Seeker title" },
    layout: { col: 1, row: 4 }
  }),

  // Endurance branch
  node({
    id: "endurance-i",
    name: "Endurance I",
    description: "Reward distance and open the Endurance path.",
    sport: "cycling",
    branch: "endurance",
    tier: 1,
    cost: 1,
    premium: false,
    requirements: [{ metric: "cyclingDistanceKm", target: 100, label: "km cycled" }],
    prerequisites: ["cyclist"],
    grant: { type: "quest_unlock", value: "distance-quests", label: "Unlocks Distance quests" },
    layout: { col: 2, row: 1 }
  }),
  node({
    id: "distance-rider",
    name: "Distance Rider",
    description: "Ride longer segments and reveal endurance routes.",
    sport: "cycling",
    branch: "endurance",
    tier: 2,
    cost: 2,
    premium: true,
    requirements: [
      { metric: "cyclingDistanceKm", target: 500, label: "km cycled" },
      { metric: "longestRideKm", target: 40, label: "km longest ride" }
    ],
    prerequisites: ["endurance-i"],
    grant: { type: "segment_filter", value: "long-endurance", label: "Unlocks the Long Endurance segment filter" },
    layout: { col: 2, row: 2 }
  }),
  node({
    id: "fondo",
    name: "Fondo",
    description: "Go the distance in a single ride.",
    sport: "cycling",
    branch: "endurance",
    tier: 3,
    cost: 2,
    premium: true,
    requirements: [{ metric: "longestRideKm", target: 80, label: "km longest ride" }],
    prerequisites: ["distance-rider"],
    grant: { type: "quest_unlock", value: "fondo-quest-chain", label: "Unlocks the Fondo quest chain" },
    layout: { col: 2, row: 3 }
  }),
  node({
    id: "ultra-rider",
    name: "Ultra Rider",
    description: "Master long-distance cycling.",
    sport: "cycling",
    branch: "endurance",
    tier: "prestige",
    cost: 3,
    premium: true,
    requirements: [
      { metric: "cyclingDistanceKm", target: 1500, label: "km cycled" },
      { metric: "longestRideKm", target: 120, label: "km longest ride" }
    ],
    prerequisites: ["fondo"],
    grant: { type: "title", value: "ultra-rider", label: "Earns the Ultra Rider title" },
    layout: { col: 2, row: 4 }
  }),

  // Cross-branch nodes
  node({
    id: "breakaway-specialist",
    name: "Breakaway Specialist",
    description: "Combine explosive flow with deep endurance.",
    sport: "cycling",
    branch: "cross",
    tier: 3,
    cost: 3,
    premium: true,
    requirements: [],
    prerequisites: ["rusher-ii", "distance-rider"],
    grant: { type: "quest_unlock", value: "flow-distance-challenges", label: "Unlocks Flow + Distance challenges" },
    layout: { col: 0.5, row: 5 }
  }),
  node({
    id: "grand-explorer",
    name: "Grand Explorer",
    description: "Pair relentless discovery with long distances.",
    sport: "cycling",
    branch: "cross",
    tier: 3,
    cost: 3,
    premium: true,
    requirements: [],
    prerequisites: ["pathfinder", "distance-rider"],
    grant: { type: "quest_unlock", value: "grand-explorer-challenges", label: "Unlocks Grand Explorer challenges" },
    layout: { col: 1.5, row: 5 }
  }),
  node({
    id: "all-rounder",
    name: "All-Rounder",
    description: "Prove mastery across flow, adventure, and endurance.",
    sport: "cycling",
    branch: "cross",
    tier: "prestige",
    cost: 3,
    premium: true,
    requirements: [],
    prerequisites: ["flow-hunter", "explorer", "fondo"],
    grant: { type: "badge", value: "all-rounder", label: "Earns the All-Rounder badge" },
    layout: { col: 1, row: 6 }
  })
];

/**
 * Validate the static catalog: non-negative costs, resolvable prerequisites, no
 * cycles, unique ids, and consistent premium tiers. Thrown errors surface broken
 * catalog edits during startup and tests rather than at request time.
 */
export const validateSkillTreeCatalog = (nodes: readonly SkillTreeNode[] = SKILL_TREE_NODES): void => {
  const byId = new Map<string, SkillTreeNode>();
  for (const candidate of nodes) {
    if (byId.has(candidate.id)) throw new Error(`Duplicate skill tree node id: ${candidate.id}`);
    byId.set(candidate.id, candidate);
  }
  for (const candidate of nodes) {
    if (!Number.isInteger(candidate.cost) || candidate.cost < 0) {
      throw new Error(`Node ${candidate.id} must have a non-negative integer cost.`);
    }
    for (const requirement of candidate.requirements) {
      if (!Number.isFinite(requirement.target) || requirement.target < 0) {
        throw new Error(`Node ${candidate.id} has an invalid requirement target for ${requirement.metric}.`);
      }
    }
    for (const prerequisite of candidate.prerequisites) {
      if (!byId.has(prerequisite)) {
        throw new Error(`Node ${candidate.id} references unknown prerequisite ${prerequisite}.`);
      }
      if (prerequisite === candidate.id) {
        throw new Error(`Node ${candidate.id} cannot require itself.`);
      }
    }
    if (candidate.tier !== 1 && !candidate.premium) {
      throw new Error(`Node ${candidate.id} above tier 1 must be premium-gated.`);
    }
    if (candidate.tier === 1 && candidate.premium) {
      throw new Error(`Tier 1 node ${candidate.id} must remain free.`);
    }
  }
  // Detect prerequisite cycles with depth-first search.
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Skill tree prerequisite cycle detected at ${id}.`);
    visiting.add(id);
    for (const prerequisite of byId.get(id)!.prerequisites) visit(prerequisite);
    visiting.delete(id);
    visited.add(id);
  };
  for (const candidate of nodes) visit(candidate.id);
};

export const findSkillTreeNode = (nodeId: string): SkillTreeNode | undefined =>
  SKILL_TREE_NODES.find((candidate) => candidate.id === nodeId);
