import type {
  SkillTreeBranch,
  SkillTreeGrant,
  SkillTreeGrantType,
  SkillTreeNode,
  SkillTreeSport,
  SkillTreeTier
} from "./types.js";

/**
 * Player levels that grant one Skill Point each. Every level up to 12 awards a
 * point so a free player finishes the 12-point free core tier (hubs plus
 * tier-1 specializations) at level 12 (6,600 XP). After that points arrive every
 * second level through level 30 (21 points), then every third level.
 */
export const SKILL_POINT_AWARD_LEVELS: readonly number[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30
];

const SKILL_POINT_INTERVAL_AFTER_30 = 3;

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

/** The next level above `level` that awards a Skill Point. */
export const nextSkillPointLevel = (level: number): number => {
  const flooredLevel = Math.max(1, Math.floor(level));
  const next = SKILL_POINT_AWARD_LEVELS.find((awardLevel) => awardLevel > flooredLevel);
  if (next !== undefined) return next;
  const lastAward = SKILL_POINT_AWARD_LEVELS[SKILL_POINT_AWARD_LEVELS.length - 1];
  const steps = Math.floor((flooredLevel - lastAward) / SKILL_POINT_INTERVAL_AFTER_30) + 1;
  return lastAward + steps * SKILL_POINT_INTERVAL_AFTER_30;
};

type RequirementSpec = [metric: string, target: number, label: string];
type GrantSpec = [type: SkillTreeGrantType, value: string, label: string];

interface NodeSpec {
  id: string;
  name: string;
  description: string;
  sport: SkillTreeSport;
  branch: SkillTreeBranch;
  tier: SkillTreeTier;
  cost: number;
  grant: GrantSpec;
  req?: RequirementSpec[];
  pre?: string[];
  /** Legacy catalog position, retained for backwards compatibility; never drives the radial renderer. */
  layout?: { col: number; row: number };
}

/**
 * PRO gates breadth and late-game content, not tier depth: cross-sport and hybrid
 * nodes plus prestige progression. The athlete root, sport hubs and the core
 * Cycling/Running/Hiking branches through tier III stay free.
 */
export const isPremiumNode = (spec: Pick<NodeSpec, "branch" | "tier">): boolean =>
  spec.branch === "cross" || spec.branch === "cross_sport" || spec.tier === "prestige";

/**
 * Expand a terse spec into a full node. Premium gating is derived from the
 * branch and tier so the catalog can never drift from the PRO boundary. A node's
 * on-screen position is computed client-side from structure, so `layout`
 * defaults harmlessly when a node has no legacy coordinate.
 */
const node = (spec: NodeSpec): SkillTreeNode => ({
  id: spec.id,
  name: spec.name,
  description: spec.description,
  sport: spec.sport,
  branch: spec.branch,
  tier: spec.tier,
  cost: spec.cost,
  premium: isPremiumNode(spec),
  requirements: (spec.req ?? []).map(([metric, target, label]) => ({ metric, target, label })),
  prerequisites: spec.pre ?? [],
  grant: { type: spec.grant[0], value: spec.grant[1], label: spec.grant[2] } satisfies SkillTreeGrant,
  layout: spec.layout ?? { col: 0, row: 0 }
});

/**
 * Versioned static multi-sport Skill Atlas catalog. The database stores only the
 * player's chosen unlocks (node id + cost); definitions live here like collectible
 * and quest templates. Athlete is a client-side synthetic root; Cycling, Running,
 * and Hiking are equal sport hubs branching from it. Existing Cycling node ids and
 * costs are preserved so historical unlocks and balances stay valid.
 */
export const SKILL_TREE_NODES: readonly SkillTreeNode[] = [
  // ===================================================================
  // CYCLING
  // ===================================================================
  node({
    id: "cyclist",
    name: "Cycling",
    description: "Your cycling hub. Open the Flow, Explore, and Endurance specializations.",
    sport: "cycling",
    branch: "root",
    tier: 1,
    cost: 1,
    req: [["cyclingActivityCount", 1, "Rides completed"]],
    grant: ["tree_access", "cycling-branches", "Opens the cycling branches"],
    layout: { col: 1, row: 0 }
  }),

  // Cycling · FLOW
  node({
    id: "rusher-i",
    name: "Rusher I",
    description: "Reward fast, flowing riding and open the Flow path.",
    sport: "cycling",
    branch: "rush",
    tier: 1,
    cost: 1,
    req: [["flowlines", 3, "Flowlines"]],
    pre: ["cyclist"],
    grant: ["quest_unlock", "flow-quests", "Unlocks Flow quests"],
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
    req: [["flowlines", 10, "Flowlines"]],
    pre: ["rusher-i"],
    grant: ["world_filter", "high-flow", "Adds the High Flow filter for Flowlines to World"],
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
    req: [["flowlines", 20, "Flowlines"]],
    pre: ["rusher-ii"],
    grant: ["quest_unlock", "flow-hunter-quests", "Unlocks Flow Hunter quests"],
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
    req: [["flowlines", 35, "Flowlines"]],
    pre: ["flow-hunter"],
    grant: ["title", "flow-specialist", "Earns the Flow Specialist title"],
    layout: { col: 0, row: 4 }
  }),
  node({
    id: "cycling-breakaway-rider",
    name: "Breakaway Rider",
    description: "Turn raw flow into decisive, race-winning efforts.",
    sport: "cycling",
    branch: "rush",
    tier: "prestige",
    cost: 3,
    req: [["flowlines", 50, "Flowlines"], ["longestRideKm", 60, "km longest ride"]],
    pre: ["flow-specialist"],
    grant: ["quest_unlock", "breakaway-quests", "Unlocks Breakaway quests"]
  }),

  // Cycling · EXPLORE
  node({
    id: "adventurer-i",
    name: "Adventurer I",
    description: "Reward discovery and open the Explore path.",
    sport: "cycling",
    branch: "adventure",
    tier: 1,
    cost: 1,
    req: [["places", 3, "Places"]],
    pre: ["cyclist"],
    grant: ["quest_unlock", "explore-quests", "Unlocks Explore quests"],
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
    req: [["places", 8, "Places"]],
    pre: ["adventurer-i"],
    grant: ["world_filter", "undiscovered-only", "Adds the Undiscovered filter to World"],
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
    req: [["uniqueCollectibles", 20, "Unique discoveries"]],
    pre: ["pathfinder"],
    grant: ["quest_unlock", "explorer-quests", "Unlocks Explorer quests"],
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
    req: [["viewpoints", 10, "Viewpoints"]],
    pre: ["explorer"],
    grant: ["title", "world-seeker", "Earns the World Seeker title"],
    layout: { col: 1, row: 4 }
  }),
  node({
    id: "grand-explorer",
    name: "Grand Explorer",
    description: "Relentless discovery across every corner of the map.",
    sport: "cycling",
    branch: "adventure",
    tier: "prestige",
    cost: 3,
    req: [["places", 25, "Places"], ["uniqueCollectibles", 40, "Unique discoveries"]],
    pre: ["world-seeker"],
    grant: ["quest_unlock", "grand-explorer-challenges", "Unlocks Grand Explorer challenges"],
    layout: { col: 1.5, row: 5 }
  }),

  // Cycling · ENDURANCE
  node({
    id: "endurance-i",
    name: "Endurance I",
    description: "Reward distance and open the Endurance path.",
    sport: "cycling",
    branch: "endurance",
    tier: 1,
    cost: 1,
    req: [["cyclingDistanceKm", 100, "km cycled"]],
    pre: ["cyclist"],
    grant: ["quest_unlock", "distance-quests", "Unlocks Distance quests"],
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
    req: [
      ["cyclingDistanceKm", 500, "km cycled"],
      ["longestRideKm", 40, "km longest ride"]
    ],
    pre: ["endurance-i"],
    grant: ["segment_filter", "long-endurance", "Adds the Long Flowlines filter to World"],
    layout: { col: 2, row: 2 }
  }),
  node({
    id: "fondo",
    name: "Fondo Rider",
    description: "Go the distance in a single ride.",
    sport: "cycling",
    branch: "endurance",
    tier: 3,
    cost: 2,
    req: [["longestRideKm", 80, "km longest ride"]],
    pre: ["distance-rider"],
    grant: ["quest_unlock", "fondo-quest-chain", "Unlocks the Fondo quest chain"],
    layout: { col: 2, row: 3 }
  }),
  node({
    id: "cycling-climber",
    name: "Climber",
    description: "Chase elevation and conquer mountain passes.",
    sport: "cycling",
    branch: "endurance",
    tier: 3,
    cost: 2,
    req: [["totalElevationGainM", 8000, "m climbed"], ["mountainPasses", 3, "Mountain passes"]],
    pre: ["fondo"],
    grant: ["quest_unlock", "climbing-quests", "Unlocks Climbing quests"]
  }),
  node({
    id: "ultra-rider",
    name: "Ultra Rider",
    description: "Master long-distance cycling.",
    sport: "cycling",
    branch: "endurance",
    tier: "prestige",
    cost: 3,
    req: [
      ["cyclingDistanceKm", 1500, "km cycled"],
      ["longestRideKm", 120, "km longest ride"]
    ],
    pre: ["cycling-climber"],
    grant: ["title", "ultra-rider", "Earns the Ultra Rider title"],
    layout: { col: 2, row: 4 }
  }),

  // Cycling · cross-branch
  node({
    id: "cycling-fast-explorer",
    name: "Fast Explorer",
    description: "Blend high flow with relentless discovery.",
    sport: "cycling",
    branch: "cross",
    tier: 3,
    cost: 3,
    pre: ["rusher-ii", "pathfinder"],
    grant: ["quest_unlock", "flow-explore-challenges", "Unlocks Flow + Explore challenges"]
  }),
  node({
    id: "cycling-adventure-endurance",
    name: "Adventure Endurance",
    description: "Pair relentless discovery with long distances.",
    sport: "cycling",
    branch: "cross",
    tier: 3,
    cost: 3,
    pre: ["pathfinder", "distance-rider"],
    grant: ["quest_unlock", "explore-distance-challenges", "Unlocks Explore + Distance challenges"]
  }),
  node({
    id: "breakaway-specialist",
    name: "Breakaway Specialist",
    description: "Combine explosive flow with deep endurance.",
    sport: "cycling",
    branch: "cross",
    tier: 3,
    cost: 3,
    pre: ["rusher-ii", "distance-rider"],
    grant: ["quest_unlock", "flow-distance-challenges", "Unlocks Flow + Distance challenges"],
    layout: { col: 0.5, row: 5 }
  }),
  node({
    id: "all-rounder",
    name: "All-Round Cyclist",
    description: "Prove mastery across flow, exploration, and endurance.",
    sport: "cycling",
    branch: "cross",
    tier: "prestige",
    cost: 3,
    pre: ["flow-hunter", "explorer", "fondo"],
    grant: ["badge", "all-rounder", "Earns the All-Round Cyclist badge"],
    layout: { col: 1, row: 6 }
  }),

  // Cycling · prestige
  node({
    id: "cycling-flow-master",
    name: "Flow Master",
    description: "The definitive master of flowing, flat-out riding.",
    sport: "cycling",
    branch: "cross",
    tier: "prestige",
    cost: 3,
    pre: ["cycling-breakaway-rider"],
    grant: ["title", "flow-master", "Earns the Flow Master title"]
  }),
  node({
    id: "cycling-legendary-explorer",
    name: "Legendary Explorer",
    description: "A legend of cycling discovery.",
    sport: "cycling",
    branch: "cross",
    tier: "prestige",
    cost: 3,
    pre: ["grand-explorer"],
    grant: ["title", "legendary-explorer", "Earns the Legendary Explorer title"]
  }),
  node({
    id: "cycling-ultra-cyclist",
    name: "Ultra Cyclist",
    description: "Endurance cycling taken to its limit.",
    sport: "cycling",
    branch: "cross",
    tier: "prestige",
    cost: 3,
    pre: ["ultra-rider"],
    grant: ["badge", "ultra-cyclist", "Earns the Ultra Cyclist badge"]
  }),

  // ===================================================================
  // RUNNING
  // ===================================================================
  node({
    id: "runner",
    name: "Running",
    description: "Your running hub. Open the Speed, Explore, and Endurance specializations.",
    sport: "running",
    branch: "root",
    tier: 1,
    cost: 1,
    req: [["runningActivityCount", 1, "Runs completed"]],
    grant: ["tree_access", "running-branches", "Opens the running branches"]
  }),

  // Running · SPEED
  node({
    id: "run-speed-1",
    name: "Speed I",
    description: "Reward quick efforts and open the Speed path.",
    sport: "running",
    branch: "speed",
    tier: 1,
    cost: 1,
    req: [["longestRunKm", 3, "km longest run"]],
    pre: ["runner"],
    grant: ["quest_unlock", "speed-quests", "Unlocks Speed quests"]
  }),
  node({
    id: "run-speed-2",
    name: "Tempo Runner",
    description: "Hold a strong tempo over longer efforts.",
    sport: "running",
    branch: "speed",
    tier: 2,
    cost: 2,
    req: [["longestRunKm", 5, "km longest run"], ["runningActivityCount", 5, "Runs completed"]],
    pre: ["run-speed-1"],
    grant: ["quest_unlock", "tempo-quests", "Unlocks Tempo quests"]
  }),
  node({
    id: "run-speed-3",
    name: "Fast Finisher",
    description: "Close out runs with pace to spare.",
    sport: "running",
    branch: "speed",
    tier: 2,
    cost: 2,
    req: [["longestRunKm", 8, "km longest run"]],
    pre: ["run-speed-2"],
    grant: ["quest_unlock", "fast-segment-quests", "Unlocks Fast Segment quests"]
  }),
  node({
    id: "run-speed-4",
    name: "Pace Hunter",
    description: "Rack up fast kilometres across many runs.",
    sport: "running",
    branch: "speed",
    tier: 3,
    cost: 2,
    req: [["runningDistanceKm", 150, "km run"]],
    pre: ["run-speed-3"],
    grant: ["quest_unlock", "pace-quests", "Unlocks Pace quests"]
  }),
  node({
    id: "run-speed-5",
    name: "Speed Specialist",
    description: "Master the speed discipline.",
    sport: "running",
    branch: "speed",
    tier: "prestige",
    cost: 3,
    req: [["longestRunKm", 12, "km longest run"], ["runningDistanceKm", 300, "km run"]],
    pre: ["run-speed-4"],
    grant: ["title", "speed-specialist", "Earns the Speed Specialist title"]
  }),

  // Running · EXPLORE
  node({
    id: "run-explore-1",
    name: "Runner Explorer I",
    description: "Reward discovery on foot and open the Explore path.",
    sport: "running",
    branch: "adventure",
    tier: 1,
    cost: 1,
    req: [["runningUniqueCollectibles", 3, "Discoveries while running"]],
    pre: ["runner"],
    grant: ["quest_unlock", "run-explore-quests", "Unlocks Run Explore quests"]
  }),
  node({
    id: "run-explore-2",
    name: "Route Explorer",
    description: "Find new routes wherever you run.",
    sport: "running",
    branch: "adventure",
    tier: 2,
    cost: 2,
    req: [["runningUniqueCollectibles", 10, "Discoveries while running"]],
    pre: ["run-explore-1"],
    grant: ["quest_unlock", "run-route-quests", "Unlocks Run Route quests"]
  }),
  node({
    id: "run-explore-3",
    name: "Trail Seeker",
    description: "Leave the pavement behind for the trails.",
    sport: "running",
    branch: "adventure",
    tier: 2,
    cost: 2,
    req: [["runningViewpoints", 5, "Viewpoints while running"]],
    pre: ["run-explore-2"],
    grant: ["quest_unlock", "trail-running-quests", "Unlocks Trail Running quests"]
  }),
  node({
    id: "run-explore-4",
    name: "Nature Runner",
    description: "Seek out the natural world on every run.",
    sport: "running",
    branch: "adventure",
    tier: 3,
    cost: 2,
    req: [["runningUniqueCollectibles", 25, "Discoveries while running"]],
    pre: ["run-explore-3"],
    grant: ["quest_unlock", "nature-run-quests", "Unlocks Nature Run quests"]
  }),
  node({
    id: "run-explore-5",
    name: "Running Explorer",
    description: "Master exploration on foot.",
    sport: "running",
    branch: "adventure",
    tier: "prestige",
    cost: 3,
    req: [["runningPlaces", 15, "Places while running"], ["runningUniqueCollectibles", 40, "Discoveries while running"]],
    pre: ["run-explore-4"],
    grant: ["title", "running-explorer", "Earns the Running Explorer title"]
  }),

  // Running · ENDURANCE
  node({
    id: "run-endurance-1",
    name: "Runner Endurance I",
    description: "Reward distance on foot and open the Endurance path.",
    sport: "running",
    branch: "endurance",
    tier: 1,
    cost: 1,
    req: [["runningDistanceKm", 20, "km run"]],
    pre: ["runner"],
    grant: ["quest_unlock", "run-distance-quests", "Unlocks Run Distance quests"]
  }),
  node({
    id: "run-endurance-2",
    name: "10K Runner",
    description: "Cover ten kilometres in a single run.",
    sport: "running",
    branch: "endurance",
    tier: 2,
    cost: 2,
    req: [["longestRunKm", 10, "km longest run"]],
    pre: ["run-endurance-1"],
    grant: ["quest_unlock", "ten-k-quests", "Unlocks 10K quests"]
  }),
  node({
    id: "run-endurance-3",
    name: "Half Distance",
    description: "Reach half-marathon distance.",
    sport: "running",
    branch: "endurance",
    tier: 2,
    cost: 2,
    req: [["longestRunKm", 21, "km longest run"]],
    pre: ["run-endurance-2"],
    grant: ["quest_unlock", "half-distance-quests", "Unlocks Half Distance quests"]
  }),
  node({
    id: "run-endurance-4",
    name: "Long Run Specialist",
    description: "Make the long run your strength.",
    sport: "running",
    branch: "endurance",
    tier: 3,
    cost: 2,
    req: [["longestRunKm", 30, "km longest run"], ["runningDistanceKm", 400, "km run"]],
    pre: ["run-endurance-3"],
    grant: ["quest_unlock", "long-run-quests", "Unlocks Long Run quests"]
  }),
  node({
    id: "run-endurance-5",
    name: "Ultra Runner",
    description: "Master long-distance running.",
    sport: "running",
    branch: "endurance",
    tier: "prestige",
    cost: 3,
    req: [["longestRunKm", 50, "km longest run"], ["runningDistanceKm", 800, "km run"]],
    pre: ["run-endurance-4"],
    grant: ["title", "ultra-runner", "Earns the Ultra Runner title"]
  }),

  // Running · cross-branch
  node({
    id: "run-fast-explorer",
    name: "Fast Explorer",
    description: "Blend pace with relentless route discovery.",
    sport: "running",
    branch: "cross",
    tier: 3,
    cost: 3,
    pre: ["run-speed-2", "run-explore-2"],
    grant: ["quest_unlock", "run-fast-explore-challenges", "Unlocks Speed + Explore challenges"]
  }),
  node({
    id: "run-trail-endurance",
    name: "Trail Endurance",
    description: "Combine trail exploration with long-run endurance.",
    sport: "running",
    branch: "cross",
    tier: 3,
    cost: 3,
    pre: ["run-explore-3", "run-endurance-3"],
    grant: ["quest_unlock", "trail-endurance-challenges", "Unlocks Trail + Endurance challenges"]
  }),
  node({
    id: "run-strong-finisher",
    name: "Strong Finisher",
    description: "Hold speed deep into long efforts.",
    sport: "running",
    branch: "cross",
    tier: 3,
    cost: 3,
    pre: ["run-speed-3", "run-endurance-3"],
    grant: ["quest_unlock", "strong-finisher-challenges", "Unlocks Speed + Endurance challenges"]
  }),
  node({
    id: "run-all-round",
    name: "All-Round Runner",
    description: "Prove mastery across speed, exploration, and endurance.",
    sport: "running",
    branch: "cross",
    tier: "prestige",
    cost: 3,
    pre: ["run-speed-3", "run-explore-3", "run-endurance-3"],
    grant: ["badge", "all-round-runner", "Earns the All-Round Runner badge"]
  }),

  // Running · prestige
  node({
    id: "run-pace-master",
    name: "Pace Master",
    description: "The definitive master of running speed.",
    sport: "running",
    branch: "cross",
    tier: "prestige",
    cost: 3,
    pre: ["run-speed-5"],
    grant: ["title", "pace-master", "Earns the Pace Master title"]
  }),
  node({
    id: "run-trail-master",
    name: "Trail Master",
    description: "A legend of trail and nature running.",
    sport: "running",
    branch: "cross",
    tier: "prestige",
    cost: 3,
    pre: ["run-explore-5"],
    grant: ["title", "trail-master", "Earns the Trail Master title"]
  }),
  node({
    id: "run-endurance-legend",
    name: "Endurance Legend",
    description: "Running endurance taken to its limit.",
    sport: "running",
    branch: "cross",
    tier: "prestige",
    cost: 3,
    pre: ["run-endurance-5"],
    grant: ["badge", "endurance-legend", "Earns the Endurance Legend badge"]
  }),

  // ===================================================================
  // HIKING
  // ===================================================================
  node({
    id: "hiker",
    name: "Hiking",
    description: "Your hiking hub. Open the Summit, Explore, and Endurance specializations.",
    sport: "hiking",
    branch: "root",
    tier: 1,
    cost: 1,
    req: [["hikingActivityCount", 1, "Hikes completed"]],
    grant: ["tree_access", "hiking-branches", "Opens the hiking branches"]
  }),

  // Hiking · SUMMIT
  node({
    id: "hike-summit-1",
    name: "Summit I",
    description: "Reward reaching high places and open the Summit path.",
    sport: "hiking",
    branch: "summit",
    tier: 1,
    cost: 1,
    req: [["hikingPeaks", 1, "Peaks while hiking"]],
    pre: ["hiker"],
    grant: ["quest_unlock", "summit-quests", "Unlocks Summit quests"]
  }),
  node({
    id: "hike-summit-2",
    name: "Peak Seeker",
    description: "Seek out the peaks around you.",
    sport: "hiking",
    branch: "summit",
    tier: 2,
    cost: 2,
    req: [["hikingPeaks", 3, "Peaks while hiking"]],
    pre: ["hike-summit-1"],
    grant: ["world_filter", "peaks-only", "Adds the Peaks filter to World"]
  }),
  node({
    id: "hike-summit-3",
    name: "Mountain Hunter",
    description: "Make summiting mountains a habit.",
    sport: "hiking",
    branch: "summit",
    tier: 2,
    cost: 2,
    req: [["hikingPeaks", 6, "Peaks while hiking"]],
    pre: ["hike-summit-2"],
    grant: ["quest_unlock", "mountain-hunter-quests", "Unlocks Mountain Hunter quests"]
  }),
  node({
    id: "hike-summit-4",
    name: "Pass Collector",
    description: "Collect the great mountain passes on foot.",
    sport: "hiking",
    branch: "summit",
    tier: 3,
    cost: 2,
    req: [["hikingMountainPasses", 3, "Mountain passes while hiking"]],
    pre: ["hike-summit-3"],
    grant: ["quest_unlock", "pass-collector-quests", "Unlocks Pass Collector quests"]
  }),
  node({
    id: "hike-summit-5",
    name: "Summit Master",
    description: "Master the summit discipline.",
    sport: "hiking",
    branch: "summit",
    tier: "prestige",
    cost: 3,
    req: [["hikingPeaks", 12, "Peaks while hiking"], ["hikingMountainPasses", 5, "Mountain passes while hiking"]],
    pre: ["hike-summit-4"],
    grant: ["quest_unlock", "advanced-summit-quests", "Unlocks advanced Summit quests"]
  }),

  // Hiking · EXPLORE
  node({
    id: "hike-explore-1",
    name: "Hiker Explorer I",
    description: "Reward discovery on the trail and open the Explore path.",
    sport: "hiking",
    branch: "adventure",
    tier: 1,
    cost: 1,
    req: [["hikingUniqueCollectibles", 3, "Discoveries while hiking"]],
    pre: ["hiker"],
    grant: ["quest_unlock", "hike-explore-quests", "Unlocks Hike Explore quests"]
  }),
  node({
    id: "hike-pathfinder",
    name: "Pathfinder",
    description: "Find the trails and places others miss.",
    sport: "hiking",
    branch: "adventure",
    tier: 2,
    cost: 2,
    req: [["hikingUniqueCollectibles", 10, "Discoveries while hiking"]],
    pre: ["hike-explore-1"],
    grant: ["quest_unlock", "hike-route-quests", "Unlocks Hike Route quests"]
  }),
  node({
    id: "hike-landmark-seeker",
    name: "Landmark Seeker",
    description: "Seek out landmarks and places on foot.",
    sport: "hiking",
    branch: "adventure",
    tier: 2,
    cost: 2,
    req: [["hikingPlaces", 8, "Places while hiking"]],
    pre: ["hike-pathfinder"],
    grant: ["quest_unlock", "landmark-quests", "Unlocks Landmark quests"]
  }),
  node({
    id: "hike-wilderness-explorer",
    name: "Wilderness Explorer",
    description: "Explore deep into the wilderness.",
    sport: "hiking",
    branch: "adventure",
    tier: 3,
    cost: 2,
    req: [["hikingUniqueCollectibles", 25, "Discoveries while hiking"]],
    pre: ["hike-landmark-seeker"],
    grant: ["quest_unlock", "wilderness-quests", "Unlocks Wilderness quests"]
  }),
  node({
    id: "hike-world-walker",
    name: "World Walker",
    description: "Master exploration on foot.",
    sport: "hiking",
    branch: "adventure",
    tier: "prestige",
    cost: 3,
    req: [["hikingPlaces", 20, "Places while hiking"], ["hikingUniqueCollectibles", 40, "Discoveries while hiking"]],
    pre: ["hike-wilderness-explorer"],
    grant: ["title", "world-walker", "Earns the World Walker title"]
  }),

  // Hiking · ENDURANCE
  node({
    id: "hike-endurance-1",
    name: "Hiking Endurance I",
    description: "Reward distance on foot and open the Endurance path.",
    sport: "hiking",
    branch: "endurance",
    tier: 1,
    cost: 1,
    req: [["hikingDistanceKm", 15, "km hiked"]],
    pre: ["hiker"],
    grant: ["quest_unlock", "hike-distance-quests", "Unlocks Hike Distance quests"]
  }),
  node({
    id: "hike-distance-hiker",
    name: "Distance Hiker",
    description: "Cover serious ground on the trail.",
    sport: "hiking",
    branch: "endurance",
    tier: 2,
    cost: 2,
    req: [["hikingDistanceKm", 80, "km hiked"], ["longestHikeKm", 12, "km longest hike"]],
    pre: ["hike-endurance-1"],
    grant: ["quest_unlock", "trail-distance-quests", "Unlocks Trail Distance quests"]
  }),
  node({
    id: "hike-long-trail",
    name: "Long Trail",
    description: "Take on a long trail in a single hike.",
    sport: "hiking",
    branch: "endurance",
    tier: 2,
    cost: 2,
    req: [["longestHikeKm", 20, "km longest hike"]],
    pre: ["hike-distance-hiker"],
    grant: ["quest_unlock", "long-trail-quests", "Unlocks Long Trail quests"]
  }),
  node({
    id: "hike-elevation-hunter",
    name: "Elevation Hunter",
    description: "Chase vertical metres across your hikes.",
    sport: "hiking",
    branch: "endurance",
    tier: 3,
    cost: 2,
    req: [["hikingElevationGainM", 5000, "m climbed hiking"]],
    pre: ["hike-long-trail"],
    grant: ["quest_unlock", "elevation-quests", "Unlocks Elevation quests"]
  }),
  node({
    id: "hike-ultra-hiker",
    name: "Ultra Hiker",
    description: "Master long-distance, high-elevation hiking.",
    sport: "hiking",
    branch: "endurance",
    tier: "prestige",
    cost: 3,
    req: [
      ["hikingDistanceKm", 300, "km hiked"],
      ["longestHikeKm", 35, "km longest hike"],
      ["hikingElevationGainM", 12000, "m climbed hiking"]
    ],
    pre: ["hike-elevation-hunter"],
    grant: ["title", "ultra-hiker", "Earns the Ultra Hiker title"]
  }),

  // Hiking · cross-branch
  node({
    id: "hike-mountain-explorer",
    name: "Mountain Explorer",
    description: "Combine summiting with deep exploration.",
    sport: "hiking",
    branch: "cross",
    tier: 3,
    cost: 3,
    pre: ["hike-summit-2", "hike-pathfinder"],
    grant: ["quest_unlock", "mountain-explore-challenges", "Unlocks Summit + Explore challenges"]
  }),
  node({
    id: "hike-alpine-endurance",
    name: "Alpine Endurance",
    description: "Pair high summits with long-trail endurance.",
    sport: "hiking",
    branch: "cross",
    tier: 3,
    cost: 3,
    pre: ["hike-summit-2", "hike-long-trail"],
    grant: ["quest_unlock", "alpine-endurance-challenges", "Unlocks Summit + Endurance challenges"]
  }),
  node({
    id: "hike-long-distance-explorer",
    name: "Long-Distance Explorer",
    description: "Explore far and wide across long trails.",
    sport: "hiking",
    branch: "cross",
    tier: 3,
    cost: 3,
    pre: ["hike-landmark-seeker", "hike-long-trail"],
    grant: ["quest_unlock", "long-distance-explore-challenges", "Unlocks Explore + Endurance challenges"]
  }),
  node({
    id: "hike-all-round",
    name: "All-Round Hiker",
    description: "Prove mastery across summit, exploration, and endurance.",
    sport: "hiking",
    branch: "cross",
    tier: "prestige",
    cost: 3,
    pre: ["hike-summit-3", "hike-landmark-seeker", "hike-long-trail"],
    grant: ["badge", "all-round-hiker", "Earns the All-Round Hiker badge"]
  }),

  // Hiking · prestige
  node({
    id: "hike-summit-legend",
    name: "Summit Legend",
    description: "A legend of the high summits.",
    sport: "hiking",
    branch: "cross",
    tier: "prestige",
    cost: 3,
    pre: ["hike-summit-5"],
    grant: ["title", "summit-legend", "Earns the Summit Legend title"]
  }),
  node({
    id: "hike-wilderness-legend",
    name: "Wilderness Legend",
    description: "A legend of wild, remote exploration.",
    sport: "hiking",
    branch: "cross",
    tier: "prestige",
    cost: 3,
    pre: ["hike-world-walker"],
    grant: ["badge", "wilderness-legend", "Earns the Wilderness Legend badge"]
  }),

  // ===================================================================
  // CROSS-SPORT (sit between sport sectors)
  // ===================================================================
  node({
    id: "xs-weekend-warrior",
    name: "Weekend Warrior",
    description: "Stay active across more than one sport.",
    sport: "cycling",
    branch: "cross_sport",
    tier: 2,
    cost: 2,
    req: [["distinctSportCount", 2, "Sports with activity"]],
    pre: ["cyclist", "runner"],
    grant: ["quest_unlock", "weekend-warrior-quests", "Unlocks Weekend Warrior quests"]
  }),
  node({
    id: "xs-dual-athlete",
    name: "Dual Athlete",
    description: "Build real endurance across cycling and running.",
    sport: "cycling",
    branch: "cross_sport",
    tier: 3,
    cost: 3,
    pre: ["endurance-i", "run-endurance-1"],
    grant: ["quest_unlock", "dual-athlete-quests", "Unlocks Dual Athlete quests"]
  }),
  node({
    id: "xs-bike-hike-explorer",
    name: "Bike & Hike Explorer",
    description: "Explore the world by bike and on foot.",
    sport: "hiking",
    branch: "cross_sport",
    tier: 3,
    cost: 3,
    pre: ["pathfinder", "hike-pathfinder"],
    grant: ["quest_unlock", "bike-hike-explore-quests", "Unlocks Bike & Hike Explore quests"]
  }),
  node({
    id: "xs-run-hike-explorer",
    name: "Run & Hike Explorer",
    description: "Explore on foot, running and hiking alike.",
    sport: "running",
    branch: "cross_sport",
    tier: 3,
    cost: 3,
    pre: ["run-explore-2", "hike-pathfinder"],
    grant: ["quest_unlock", "run-hike-explore-quests", "Unlocks Run & Hike Explore quests"]
  }),
  node({
    id: "xs-endurance-hybrid",
    name: "Endurance Hybrid",
    description: "Deep endurance across cycling and running.",
    sport: "running",
    branch: "cross_sport",
    tier: 3,
    cost: 3,
    pre: ["distance-rider", "run-endurance-3"],
    grant: ["quest_unlock", "endurance-hybrid-quests", "Unlocks Endurance Hybrid quests"]
  }),
  node({
    id: "xs-mountain-athlete",
    name: "Mountain Athlete",
    description: "Conquer mountains by bike, on the run, and on foot.",
    sport: "hiking",
    branch: "cross_sport",
    tier: "prestige",
    cost: 4,
    pre: ["cycling-climber", "run-endurance-4", "hike-summit-3"],
    grant: ["title", "mountain-athlete", "Earns the Mountain Athlete title"]
  }),
  node({
    id: "xs-multi-sport-explorer",
    name: "Multi-Sport Explorer",
    description: "Explore meaningfully across all three sports.",
    sport: "running",
    branch: "cross_sport",
    tier: "prestige",
    cost: 4,
    pre: ["explorer", "run-explore-3", "hike-landmark-seeker"],
    grant: ["quest_unlock", "cross-sport-quests", "Unlocks Cross-Sport quests"]
  }),
  node({
    id: "xs-triple-discipline",
    name: "Triple Discipline",
    description: "Make real progress in cycling, running, and hiking.",
    sport: "cycling",
    branch: "cross_sport",
    tier: "prestige",
    cost: 4,
    pre: ["endurance-i", "run-endurance-1", "hike-endurance-1"],
    grant: ["badge", "triple-discipline", "Earns the Triple Discipline badge"]
  }),
  node({
    id: "xs-complete-athlete",
    name: "Complete Athlete",
    description: "Advanced, all-round mastery across every sport.",
    sport: "cycling",
    branch: "cross_sport",
    tier: "prestige",
    cost: 5,
    pre: ["all-rounder", "run-all-round", "hike-all-round"],
    grant: ["badge", "complete-athlete", "Earns the Complete Athlete badge"]
  }),

  // ===================================================================
  // GLOBAL PRESTIGE
  // ===================================================================
  node({
    id: "global-multi-sport-legend",
    name: "Multi-Sport Legend",
    description: "A legend across every discipline you train.",
    sport: "running",
    branch: "cross_sport",
    tier: "prestige",
    cost: 4,
    pre: ["xs-multi-sport-explorer"],
    grant: ["title", "multi-sport-legend", "Earns the Multi-Sport Legend title"]
  }),
  node({
    id: "global-world-mover",
    name: "World Mover",
    description: "Move across the world under your own power.",
    sport: "hiking",
    branch: "cross_sport",
    tier: "prestige",
    cost: 4,
    req: [["totalDistanceKm", 3000, "km travelled"]],
    pre: ["xs-triple-discipline"],
    grant: ["badge", "world-mover", "Earns the World Mover badge"]
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
    if (candidate.premium !== isPremiumNode(candidate)) {
      throw new Error(`Node ${candidate.id} premium flag disagrees with the PRO boundary.`);
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
