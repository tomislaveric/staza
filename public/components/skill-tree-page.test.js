import { describe, expect, it } from "vitest";
import {
  SkillNodeDetail,
  SkillTreeGraph,
  SkillTreeHeader,
  skillTreeViewModel,
  svgDimensions
} from "./skill-tree-page.js";

const view = {
  earnedPoints: 5,
  spentPoints: 2,
  balance: 3,
  nodes: [
    {
      id: "cyclist",
      name: "Cyclist",
      description: "Begin your journey.",
      tier: 1,
      branch: "root",
      cost: 0,
      premium: false,
      state: "unlocked",
      prerequisites: [],
      prerequisitesMet: true,
      requirements: [],
      grant: { type: "tree_access", label: "Unlocks the cycling branches" },
      layout: { col: 1, row: 0 }
    },
    {
      id: "rush-1",
      name: "Rusher I",
      description: "Reward fast riding.",
      tier: 1,
      branch: "rush",
      cost: 2,
      premium: false,
      state: "unlockable",
      prerequisites: ["cyclist"],
      prerequisitesMet: true,
      requirements: [{ label: "Flowlines", current: 5, target: 3, met: true }],
      grant: { type: "quest_unlock", label: "Unlocks Flow quests" },
      layout: { col: 0, row: 1 }
    },
    {
      id: "flow-hunter",
      name: "Flow Hunter",
      description: "Sharpen your flow.",
      tier: 2,
      branch: "rush",
      cost: 3,
      premium: true,
      state: "locked",
      prerequisites: ["rush-1"],
      prerequisitesMet: false,
      requirements: [{ label: "Flowlines", current: 2, target: 10, met: false }],
      grant: { type: "world_filter", label: "Unlocks the High Flow map filter" },
      layout: { col: 0, row: 2 }
    }
  ]
};

describe("Skill tree view model", () => {
  it("builds connectors from prerequisites and marks active edges", () => {
    const model = skillTreeViewModel(view);
    expect(model.connectors).toHaveLength(2);
    const [rushEdge, flowEdge] = model.connectors;
    expect(rushEdge.active).toBe(false);
    expect(flowEdge.active).toBe(false);
  });

  it("marks an edge active only when both endpoints are unlocked", () => {
    const unlocked = {
      ...view,
      nodes: view.nodes.map((node) =>
        node.id === "rush-1" ? { ...node, state: "unlocked" } : node)
    };
    const model = skillTreeViewModel(unlocked);
    expect(model.connectors[0].active).toBe(true);
  });

  it("sizes the svg to contain every node", () => {
    const { width, height } = svgDimensions(view.nodes);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });
});

describe("Skill tree rendering", () => {
  it("renders the balance and point breakdown in the header", () => {
    const header = SkillTreeHeader(view);
    expect(header).toContain("Skill Points");
    expect(header).toContain("2 spent · 5 earned");
  });

  it("renders a node glyph per node with its state class and a PRO badge for premium", () => {
    const graph = SkillTreeGraph(skillTreeViewModel(view));
    expect(graph).toContain('data-node-id="cyclist"');
    expect(graph).toContain("is-unlockable");
    expect(graph).toContain("skill-node-pro");
    expect(graph).toContain("skill-node-icon");
    expect(graph).toContain('data-tier="1"');
  });

  it("labels specialization branches on the map", () => {
    const graph = SkillTreeGraph(skillTreeViewModel(view));
    expect(graph).toContain("FLOW");
  });

  it("shows an unlock button and the grant type for an unlockable node", () => {
    const detail = SkillNodeDetail(view.nodes[1]);
    expect(detail).toContain('data-skill-unlock="rush-1"');
    expect(detail).toContain("Unlock · 2 SP");
    expect(detail).toContain("READY TO UNLOCK");
    expect(detail).toContain("QUEST");
  });

  it("renders a fulfilled requirement as completed without exceeding the bar", () => {
    const detail = SkillNodeDetail(view.nodes[1]);
    expect(detail).toContain("Completed");
    expect(detail).not.toContain("5 / 3");
    expect(detail).toContain("width: 100%");
  });

  it("shows the remaining progress for an unmet requirement", () => {
    const detail = SkillNodeDetail(view.nodes[2]);
    expect(detail).toContain("2 / 10");
  });

  it("shows the unlocked state without an unlock button", () => {
    const detail = SkillNodeDetail(view.nodes[0]);
    expect(detail).toContain("Unlocked");
    expect(detail).not.toContain("data-skill-unlock");
  });

  it("hints to unlock the prerequisite when it is not met", () => {
    const detail = SkillNodeDetail(view.nodes[2]);
    expect(detail).toContain("Unlock the connected node first.");
  });

  it("prompts for a selection when no node is given", () => {
    expect(SkillNodeDetail(null)).toContain("Select a node");
  });
});
