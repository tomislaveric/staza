import { SKILL_TREE_NODES } from "./catalog.js";
import { earnedSkillPointsForLevel, nextSkillPointLevel } from "./catalog.js";
import { getTotalXpRequiredForLevel } from "../progression.js";
import type {
  SkillTreeNode,
  SkillTreeNodeState,
  SkillTreeNodeView,
  SkillTreeStats,
  SkillTreeUnlockErrorCode,
  SkillTreeView
} from "./types.js";

/**
 * Flatten durable stats into the numeric metrics referenced by node
 * requirements. Distances are exposed in kilometres for readable targets.
 */
export const statMetrics = (stats: SkillTreeStats): Record<string, number> => ({
  level: stats.level,
  totalXp: stats.totalXp,
  totalDistanceKm: stats.totalDistanceM / 1000,
  cyclingDistanceKm: stats.cyclingDistanceM / 1000,
  runningDistanceKm: stats.runningDistanceM / 1000,
  hikingDistanceKm: stats.hikingDistanceM / 1000,
  longestRideKm: stats.longestRideM / 1000,
  longestRunKm: stats.longestRunM / 1000,
  longestHikeKm: stats.longestHikeM / 1000,
  activityCount: stats.activityCount,
  cyclingActivityCount: stats.cyclingActivityCount,
  runningActivityCount: stats.runningActivityCount,
  hikingActivityCount: stats.hikingActivityCount,
  distinctSportCount: stats.distinctSportCount,
  totalElevationGainM: stats.totalElevationGainM,
  hikingElevationGainM: stats.hikingElevationGainM,
  flowlines: stats.uniqueFlowlines,
  uniqueCollectibles: stats.uniqueCollectibles,
  runningUniqueCollectibles: stats.runningUniqueCollectibles,
  hikingUniqueCollectibles: stats.hikingUniqueCollectibles,
  viewpoints: stats.categoryCounts.viewpoint,
  peaks: stats.categoryCounts.peak,
  castles: stats.categoryCounts.castle,
  waterfalls: stats.categoryCounts.waterfall,
  places: stats.categoryCounts.place,
  mountainPasses: stats.categoryCounts.mountain_pass,
  runningPlaces: stats.runningCategoryCounts.place,
  runningViewpoints: stats.runningCategoryCounts.viewpoint,
  hikingPeaks: stats.hikingCategoryCounts.peak,
  hikingMountainPasses: stats.hikingCategoryCounts.mountain_pass,
  hikingViewpoints: stats.hikingCategoryCounts.viewpoint,
  hikingPlaces: stats.hikingCategoryCounts.place
});

export const earnedPoints = (stats: SkillTreeStats): number =>
  earnedSkillPointsForLevel(stats.level);

const nextSkillPointProgress = (stats: SkillTreeStats): SkillTreeView["nextSkillPoint"] => {
  const level = nextSkillPointLevel(stats.level);
  const from = getTotalXpRequiredForLevel(stats.level);
  const to = getTotalXpRequiredForLevel(level);
  return {
    level,
    xpRemaining: Math.max(0, to - stats.totalXp),
    progress: Math.max(0, Math.min(1, (stats.totalXp - from) / (to - from)))
  };
};

export const spentPoints = (
  unlockedNodeIds: Iterable<string>,
  nodes: readonly SkillTreeNode[] = SKILL_TREE_NODES
): number => {
  const unlocked = new Set(unlockedNodeIds);
  return nodes
    .filter((node) => unlocked.has(node.id))
    .reduce((total, node) => total + node.cost, 0);
};

export const balance = (
  stats: SkillTreeStats,
  unlockedNodeIds: Iterable<string>,
  nodes: readonly SkillTreeNode[] = SKILL_TREE_NODES
): number => earnedPoints(stats) - spentPoints(unlockedNodeIds, nodes);

const requirementsMet = (node: SkillTreeNode, metrics: Record<string, number>): boolean =>
  node.requirements.every((requirement) => (metrics[requirement.metric] ?? 0) >= requirement.target);

const prerequisitesMet = (node: SkillTreeNode, unlocked: Set<string>): boolean =>
  node.prerequisites.every((prerequisite) => unlocked.has(prerequisite));

export const nodeState = (
  node: SkillTreeNode,
  stats: SkillTreeStats,
  unlocked: Set<string>,
  isPremium: boolean,
  availableBalance: number
): SkillTreeNodeState => {
  if (unlocked.has(node.id)) return "unlocked";
  if (node.premium && !isPremium) return "premium_locked";
  const eligible =
    requirementsMet(node, statMetrics(stats)) &&
    prerequisitesMet(node, unlocked) &&
    availableBalance >= node.cost;
  return eligible ? "unlockable" : "locked";
};

/**
 * Server-authoritative eligibility check for an explicit unlock. Returns an
 * error code when the node cannot be unlocked, or `null` when it can.
 */
export const unlockRejectionCode = (
  node: SkillTreeNode,
  stats: SkillTreeStats,
  unlocked: Set<string>,
  isPremium: boolean,
  availableBalance: number
): SkillTreeUnlockErrorCode | null => {
  if (node.premium && !isPremium) return "premium_required";
  if (!prerequisitesMet(node, unlocked)) return "prerequisite_locked";
  if (!requirementsMet(node, statMetrics(stats))) return "requirement_not_met";
  if (availableBalance < node.cost) return "insufficient_points";
  return null;
};

export const buildSkillTreeView = (
  stats: SkillTreeStats,
  unlockedNodeIds: Iterable<string>,
  isPremium: boolean,
  nodes: readonly SkillTreeNode[] = SKILL_TREE_NODES
): SkillTreeView => {
  const unlocked = new Set(unlockedNodeIds);
  const metrics = statMetrics(stats);
  const earned = earnedPoints(stats);
  const spent = spentPoints(unlocked, nodes);
  const availableBalance = earned - spent;
  const nodeViews: SkillTreeNodeView[] = nodes.map((node) => {
    const requirementViews = node.requirements.map((requirement) => {
      const current = metrics[requirement.metric] ?? 0;
      return { ...requirement, current, met: current >= requirement.target };
    });
    const reqMet = requirementViews.every((requirement) => requirement.met);
    const preMet = prerequisitesMet(node, unlocked);
    const affordable = availableBalance >= node.cost;
    return {
      id: node.id,
      name: node.name,
      description: node.description,
      sport: node.sport,
      branch: node.branch,
      tier: node.tier,
      cost: node.cost,
      premium: node.premium,
      grant: node.grant,
      prerequisites: node.prerequisites,
      layout: node.layout,
      state: nodeState(node, stats, unlocked, isPremium, availableBalance),
      requirements: requirementViews,
      requirementsMet: reqMet,
      prerequisitesMet: preMet,
      affordable
    };
  });
  return {
    isPremium,
    earnedPoints: earned,
    spentPoints: spent,
    balance: availableBalance,
    nextSkillPoint: nextSkillPointProgress(stats),
    stats,
    nodes: nodeViews
  };
};
