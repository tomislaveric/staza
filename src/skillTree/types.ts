export type SkillTreeSport = "cycling" | "running" | "hiking";

export type SkillTreeBranch =
  | "root"
  | "rush"
  | "speed"
  | "summit"
  | "adventure"
  | "endurance"
  | "cross"
  | "cross_sport";

export type SkillTreeTier = 1 | 2 | 3 | "prestige";

export type SkillTreeGrantType =
  | "badge"
  | "title"
  | "quest_unlock"
  | "world_filter"
  | "segment_filter"
  | "tree_access";

export interface SkillTreeGrant {
  type: SkillTreeGrantType;
  value: string;
  label: string;
}

/**
 * A numeric requirement evaluated against the flattened player stat metrics.
 * `metric` is a key produced by `statMetrics`; `target` is the value the player
 * must reach. Progress values are never consumed by unlocking.
 */
export interface SkillTreeRequirement {
  metric: string;
  target: number;
  label: string;
}

export interface SkillTreeNode {
  id: string;
  name: string;
  description: string;
  sport: SkillTreeSport;
  branch: SkillTreeBranch;
  tier: SkillTreeTier;
  cost: number;
  premium: boolean;
  requirements: SkillTreeRequirement[];
  prerequisites: string[];
  grant: SkillTreeGrant;
  layout: { col: number; row: number };
}

/**
 * Durable, multi-activity progress aggregated for a player. Used to evaluate
 * node requirements and to display `current / target` progress.
 */
export interface SkillTreeStats {
  totalXp: number;
  level: number;
  totalDistanceM: number;
  cyclingDistanceM: number;
  runningDistanceM: number;
  hikingDistanceM: number;
  longestRideM: number;
  longestRunM: number;
  longestHikeM: number;
  activityCount: number;
  cyclingActivityCount: number;
  runningActivityCount: number;
  hikingActivityCount: number;
  /** Count of distinct activity types with at least one activity (cumulative). */
  distinctSportCount: number;
  totalElevationGainM: number;
  hikingElevationGainM: number;
  uniqueFlowlines: number;
  categoryCounts: SkillTreeCategoryCounts;
  /** Unique collectibles discovered on runs, by category. */
  runningCategoryCounts: SkillTreeCategoryCounts;
  /** Unique collectibles discovered on hikes, by category. */
  hikingCategoryCounts: SkillTreeCategoryCounts;
  uniqueCollectibles: number;
  /** Unique collectibles discovered while running (any category). */
  runningUniqueCollectibles: number;
  /** Unique collectibles discovered while hiking (any category). */
  hikingUniqueCollectibles: number;
}

export interface SkillTreeCategoryCounts {
  viewpoint: number;
  peak: number;
  castle: number;
  waterfall: number;
  place: number;
  mountain_pass: number;
}

export type SkillTreeNodeState =
  | "locked"
  | "unlockable"
  | "unlocked"
  | "premium_locked";

export interface SkillTreeRequirementView extends SkillTreeRequirement {
  current: number;
  met: boolean;
}

export interface SkillTreeNodeView {
  id: string;
  name: string;
  description: string;
  sport: SkillTreeSport;
  branch: SkillTreeBranch;
  tier: SkillTreeTier;
  cost: number;
  premium: boolean;
  grant: SkillTreeGrant;
  prerequisites: string[];
  layout: { col: number; row: number };
  state: SkillTreeNodeState;
  requirements: SkillTreeRequirementView[];
  requirementsMet: boolean;
  prerequisitesMet: boolean;
  affordable: boolean;
}

export interface SkillTreeView {
  isPremium: boolean;
  earnedPoints: number;
  spentPoints: number;
  balance: number;
  stats: SkillTreeStats;
  nodes: SkillTreeNodeView[];
}

export type SkillTreeUnlockErrorCode =
  | "unknown_node"
  | "requirement_not_met"
  | "prerequisite_locked"
  | "insufficient_points"
  | "premium_required";
