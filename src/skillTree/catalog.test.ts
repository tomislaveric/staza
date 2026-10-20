import { describe, expect, it } from "vitest";
import {
  SKILL_TREE_NODES,
  earnedSkillPointsForLevel,
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
      if (node.tier === 1) expect(node.premium).toBe(false);
      else expect(node.premium).toBe(true);
    }
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
    expect(earnedSkillPointsForLevel(2)).toBe(1);
    expect(earnedSkillPointsForLevel(3)).toBe(2);
    expect(earnedSkillPointsForLevel(30)).toBe(10);
    expect(earnedSkillPointsForLevel(34)).toBe(11);
    expect(earnedSkillPointsForLevel(38)).toBe(12);
  });

  it("finds nodes by id", () => {
    expect(findSkillTreeNode("cyclist")?.name).toBe("Cyclist");
    expect(findSkillTreeNode("missing")).toBeUndefined();
  });
});
