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
      cost: 0,
      premium: false,
      state: "unlocked",
      prerequisites: [],
      prerequisitesMet: true,
      requirements: [],
      grant: { label: "Unlocks the cycling branches" },
      layout: { col: 1, row: 0 }
    },
    {
      id: "rush-1",
      name: "Rusher I",
      description: "Reward fast riding.",
      cost: 2,
      premium: false,
      state: "unlockable",
      prerequisites: ["cyclist"],
      prerequisitesMet: true,
      requirements: [{ label: "Flowlines", current: 3, target: 3, met: true }],
      grant: { label: "Unlocks Flow quests" },
      layout: { col: 0, row: 1 }
    },
    {
      id: "flow-hunter",
      name: "Flow Hunter",
      description: "Sharpen your flow.",
      cost: 3,
      premium: true,
      state: "locked",
      prerequisites: ["rush-1"],
      prerequisitesMet: false,
      requirements: [{ label: "Flowlines", current: 2, target: 10, met: false }],
      grant: { label: "Unlocks the High Flow map filter" },
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

  it("renders a node glyph per node with its state class", () => {
    const graph = SkillTreeGraph(skillTreeViewModel(view));
    expect(graph).toContain('data-node-id="cyclist"');
    expect(graph).toContain("is-unlockable");
    expect(graph).toContain("skill-node-premium");
  });

  it("shows an unlock button for an unlockable node", () => {
    const detail = SkillNodeDetail(view.nodes[1]);
    expect(detail).toContain('data-skill-unlock="rush-1"');
    expect(detail).toContain("Unlock · 2 SP");
    expect(detail).toContain("READY TO UNLOCK");
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
