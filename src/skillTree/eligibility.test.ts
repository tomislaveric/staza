import { describe, expect, it } from "vitest";
import {
  balance,
  buildSkillTreeView,
  earnedPoints,
  nodeState,
  spentPoints,
  statMetrics,
  unlockRejectionCode
} from "./eligibility.js";
import type { SkillTreeNode, SkillTreeStats } from "./types.js";

const baseStats: SkillTreeStats = {
  totalXp: 0,
  level: 1,
  totalDistanceM: 0,
  cyclingDistanceM: 0,
  runningDistanceM: 0,
  hikingDistanceM: 0,
  longestRideM: 0,
  longestRunM: 0,
  longestHikeM: 0,
  activityCount: 0,
  cyclingActivityCount: 0,
  runningActivityCount: 0,
  hikingActivityCount: 0,
  distinctSportCount: 0,
  totalElevationGainM: 0,
  hikingElevationGainM: 0,
  uniqueFlowlines: 0,
  categoryCounts: { viewpoint: 0, peak: 0, castle: 0, waterfall: 0, place: 0, mountain_pass: 0 },
  runningCategoryCounts: { viewpoint: 0, peak: 0, castle: 0, waterfall: 0, place: 0, mountain_pass: 0 },
  hikingCategoryCounts: { viewpoint: 0, peak: 0, castle: 0, waterfall: 0, place: 0, mountain_pass: 0 },
  uniqueCollectibles: 0,
  runningUniqueCollectibles: 0,
  hikingUniqueCollectibles: 0
};

const node = (overrides: Partial<SkillTreeNode> = {}): SkillTreeNode => ({
  id: "n",
  name: "N",
  description: "",
  sport: "cycling",
  branch: "rush",
  tier: 1,
  cost: 1,
  premium: false,
  requirements: [],
  prerequisites: [],
  grant: { type: "badge", value: "n", label: "" },
  layout: { col: 0, row: 0 },
  ...overrides
});

describe("skill tree eligibility", () => {
  it("flattens stats into metrics in kilometres", () => {
    const metrics = statMetrics({ ...baseStats, cyclingDistanceM: 1500, longestRideM: 42000, uniqueFlowlines: 3 });
    expect(metrics.cyclingDistanceKm).toBe(1.5);
    expect(metrics.longestRideKm).toBe(42);
    expect(metrics.flowlines).toBe(3);
  });

  it("derives earned, spent, and balance", () => {
    const nodes = [node({ id: "a", cost: 1 }), node({ id: "b", cost: 2 })];
    const stats = { ...baseStats, level: 3 };
    expect(earnedPoints(stats)).toBe(3);
    expect(spentPoints(["a", "b"], nodes)).toBe(3);
    expect(balance(stats, ["a"], nodes)).toBe(2);
  });

  it("marks a node unlockable only when eligible and affordable", () => {
    const target = node({ id: "t", cost: 1, requirements: [{ metric: "flowlines", target: 3, label: "Flowlines" }] });
    const stats = { ...baseStats, level: 1, uniqueFlowlines: 3 };
    expect(nodeState(target, stats, new Set(), true, 1)).toBe("unlockable");
    expect(nodeState(target, stats, new Set(), true, 0)).toBe("locked");
    expect(nodeState(target, { ...stats, uniqueFlowlines: 2 }, new Set(), true, 1)).toBe("locked");
    expect(nodeState(target, stats, new Set(["t"]), true, 1)).toBe("unlocked");
  });

  it("marks premium nodes as premium_locked for free players", () => {
    const premiumNode = node({ id: "p", tier: 2, premium: true, cost: 2 });
    expect(nodeState(premiumNode, { ...baseStats, level: 30 }, new Set(), false, 10)).toBe("premium_locked");
    expect(nodeState(premiumNode, { ...baseStats, level: 30 }, new Set(), true, 10)).toBe("unlockable");
  });

  it("returns specific rejection codes in priority order", () => {
    const premiumNode = node({ id: "p", tier: 2, premium: true, cost: 3, prerequisites: ["x"], requirements: [{ metric: "flowlines", target: 5, label: "f" }] });
    expect(unlockRejectionCode(premiumNode, baseStats, new Set(), false, 0)).toBe("premium_required");
    expect(unlockRejectionCode(premiumNode, baseStats, new Set(), true, 10)).toBe("prerequisite_locked");
    expect(unlockRejectionCode(premiumNode, baseStats, new Set(["x"]), true, 10)).toBe("requirement_not_met");
    expect(unlockRejectionCode(premiumNode, { ...baseStats, uniqueFlowlines: 5 }, new Set(["x"]), true, 1)).toBe("insufficient_points");
    expect(unlockRejectionCode(premiumNode, { ...baseStats, uniqueFlowlines: 5 }, new Set(["x"]), true, 3)).toBeNull();
  });

  it("builds a view with per-requirement current/target progress", () => {
    const nodes = [node({ id: "t", cost: 1, requirements: [{ metric: "flowlines", target: 4, label: "Flowlines" }] })];
    const stats = { ...baseStats, level: 1, uniqueFlowlines: 2 };
    const view = buildSkillTreeView(stats, [], true, nodes);
    expect(view.earnedPoints).toBe(1);
    expect(view.balance).toBe(1);
    expect(view.nodes[0].requirements[0]).toMatchObject({ current: 2, target: 4, met: false });
    expect(view.nodes[0].state).toBe("locked");
  });
});
