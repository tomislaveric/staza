import { describe, expect, it } from "vitest";
import {
  SKILL_TREE_NODES,
  earnedSkillPointsForLevel,
  nextSkillPointLevel,
  isPremiumNode,
  validateSkillTreeCatalog,
  findSkillTreeNode
} from "./catalog.js";

describe("skill tree catalog", () => {
  it("passes structural validation", () => {
    expect(() => validateSkillTreeCatalog()).not.toThrow();
  });

  it("has unique ids, resolvable prerequisites, and consistent premium tiers", () => {
    const ids = new Set(SKILL_TREE_NODES.map((node) => node.id));
    expect(ids.size).toBe(SKILL_TREE_NODES.length);
    for (const node of SKILL_TREE_NODES) {
      expect(node.cost).toBeGreaterThanOrEqual(0);
      for (const prerequisite of node.prerequisites) {
        expect(ids.has(prerequisite)).toBe(true);
      }
      expect(node.premium).toBe(isPremiumNode(node));
    }
  });

  it("keeps core sport branches free and gates breadth and late-game nodes", () => {
    const tier2Free = SKILL_TREE_NODES.filter((node) => node.tier === 2 && !node.premium);
    expect(tier2Free.length).toBeGreaterThan(0);
    for (const node of SKILL_TREE_NODES) {
      if (node.branch === "cross" || node.branch === "cross_sport" || node.tier === "prestige") expect(node.premium).toBe(true);
    }
  });

  it("lets a free player afford the whole free tier-1 set at level 12", () => {
    const freeTier1Cost = SKILL_TREE_NODES.filter((node) => !node.premium && node.tier === 1)
      .reduce((sum, node) => sum + node.cost, 0);
    expect(freeTier1Cost).toBeLessThanOrEqual(earnedSkillPointsForLevel(12));
  });

  it("rejects a dangling prerequisite", () => {
    expect(() =>
      validateSkillTreeCatalog([
        { ...SKILL_TREE_NODES[0], id: "a", prerequisites: ["missing"] }
      ])
    ).toThrow(/unknown prerequisite/);
  });

  it("rejects a prerequisite cycle", () => {
    const base = SKILL_TREE_NODES[0];
    expect(() =>
      validateSkillTreeCatalog([
        { ...base, id: "a", prerequisites: ["b"], tier: 1, premium: false },
        { ...base, id: "b", prerequisites: ["a"], tier: 1, premium: false }
      ])
    ).toThrow(/cycle/);
  });

  it("awards skill points on the defined level curve", () => {
    expect(earnedSkillPointsForLevel(0)).toBe(0);
    expect(earnedSkillPointsForLevel(1)).toBe(1);
    expect(earnedSkillPointsForLevel(2)).toBe(2);
    expect(earnedSkillPointsForLevel(12)).toBe(12);
    expect(earnedSkillPointsForLevel(13)).toBe(12);
    expect(earnedSkillPointsForLevel(14)).toBe(13);
    expect(earnedSkillPointsForLevel(30)).toBe(21);
    expect(earnedSkillPointsForLevel(33)).toBe(22);
  });

  it("finds nodes by id", () => {
    expect(findSkillTreeNode("cyclist")?.name).toBe("Cycling");
    expect(findSkillTreeNode("missing")).toBeUndefined();
  });

  it("includes equal first-class Cycling, Running, and Hiking sport hubs", () => {
    const hubs = SKILL_TREE_NODES.filter((node) => node.branch === "root");
    expect(hubs.map((node) => node.id).sort()).toEqual(["cyclist", "hiker", "runner"]);
    for (const hub of hubs) {
      expect(hub.tier).toBe(1);
      expect(hub.premium).toBe(false);
      expect(hub.prerequisites).toEqual([]);
    }
    expect(new Set(SKILL_TREE_NODES.map((node) => node.sport))).toEqual(
      new Set(["cycling", "running", "hiking"])
    );
  });

  it("preserves every pre-existing Cycling node id for unlock compatibility", () => {
    const legacyIds = [
      "cyclist", "rusher-i", "rusher-ii", "flow-hunter", "flow-specialist",
      "adventurer-i", "pathfinder", "explorer", "world-seeker",
      "endurance-i", "distance-rider", "fondo", "ultra-rider",
      "breakaway-specialist", "grand-explorer", "all-rounder"
    ];
    for (const id of legacyIds) expect(findSkillTreeNode(id)).toBeDefined();
  });

  it("gives cross-sport nodes prerequisites spanning more than one sport", () => {
    const crossSport = SKILL_TREE_NODES.filter((node) => node.branch === "cross_sport");
    expect(crossSport.length).toBeGreaterThan(0);
    for (const node of crossSport) {
      const parents = node.prerequisites.map((id) => findSkillTreeNode(id)).filter(Boolean);
      const sports = new Set(parents.map((parent) => parent!.sport));
      // Either the node directly joins two sports, or it builds on a cross-sport
      // capstone that already does (transitive multi-sport coverage).
      const buildsOnCrossSport = parents.some((parent) => parent!.branch === "cross_sport");
      expect(sports.size >= 2 || buildsOnCrossSport).toBe(true);
    }
  });
});

describe("nextSkillPointLevel", () => {
  it("returns the next awarding level, including past level 30", () => {
    expect(nextSkillPointLevel(1)).toBe(2);
    expect(nextSkillPointLevel(12)).toBe(14);
    expect(nextSkillPointLevel(13)).toBe(14);
    expect(nextSkillPointLevel(30)).toBe(33);
    expect(nextSkillPointLevel(33)).toBe(36);
  });
});
