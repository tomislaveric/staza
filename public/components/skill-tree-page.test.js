import { describe, expect, it } from "vitest";
import { SkillNodeDetail, SkillTreeHeader } from "./skill-tree-page.js";
import { atlasLayout } from "./skill-atlas-layout.js";
import { atlasScene, nodeGlyph } from "./skill-atlas-render.js";
import { tooltipHtml } from "./skill-atlas-tooltip.js";
import { SYNTHETIC_ROOT_ID } from "./skill-atlas-visual-config.js";

const node = (overrides) => ({
  sport: "cycling",
  cost: 2,
  premium: false,
  prerequisites: [],
  prerequisitesMet: true,
  requirements: [],
  grant: { type: "quest_unlock", label: "Grant" },
  ...overrides
});

const view = {
  earnedPoints: 5,
  spentPoints: 2,
  balance: 3,
  nodes: [
    node({
      id: "cyclist",
      name: "Cyclist",
      description: "Begin your journey.",
      branch: "root",
      tier: 1,
      cost: 1,
      state: "unlocked",
      grant: { type: "tree_access", label: "Unlocks the cycling branches" }
    }),
    node({
      id: "rush-1",
      name: "Rusher I",
      description: "Reward fast riding.",
      branch: "rush",
      tier: 1,
      state: "unlockable",
      prerequisites: ["cyclist"],
      requirements: [{ label: "Flowlines", current: 5, target: 3, met: true }],
      grant: { type: "quest_unlock", label: "Unlocks Flow quests" }
    }),
    node({
      id: "flow-hunter",
      name: "Flow Hunter",
      description: "Sharpen your flow.",
      branch: "rush",
      tier: 2,
      premium: true,
      state: "locked",
      prerequisites: ["rush-1"],
      prerequisitesMet: false,
      requirements: [{ label: "Flowlines", current: 2, target: 10, met: false }],
      grant: { type: "world_filter", label: "Unlocks the High Flow map filter" }
    })
  ]
};

describe("Skill atlas layout", () => {
  it("injects a neutral synthetic root at ring 0", () => {
    const layout = atlasLayout(view);
    const root = layout.nodes.find((entry) => entry.id === SYNTHETIC_ROOT_ID);
    expect(root).toBeTruthy();
    expect(root.ring).toBe(0);
    expect(root.role).toBe("root");
    expect(root.name).toBe("Athlete");
  });

  it("places the sport root on ring 1 and branch tiers further out", () => {
    const layout = atlasLayout(view);
    const byId = new Map(layout.nodes.map((entry) => [entry.id, entry]));
    expect(byId.get("cyclist").ring).toBe(1);
    expect(byId.get("cyclist").role).toBe("sport");
    expect(byId.get("rush-1").ring).toBe(2);
    expect(byId.get("flow-hunter").ring).toBe(3);
  });

  it("connects the synthetic root to each sport node", () => {
    const layout = atlasLayout(view);
    const rootEdge = layout.connectors.find(
      (edge) => edge.fromId === SYNTHETIC_ROOT_ID && edge.toId === "cyclist"
    );
    expect(rootEdge).toBeTruthy();
  });

  it("marks an edge active only when both endpoints are unlocked", () => {
    const edge = atlasLayout(view).connectors.find((entry) => entry.toId === "rush-1");
    expect(edge.active).toBe(false);
    expect(edge.reachable).toBe(true); // prerequisite (cyclist) is unlocked

    const unlocked = {
      ...view,
      nodes: view.nodes.map((entry) =>
        entry.id === "rush-1" ? { ...entry, state: "unlocked" } : entry)
    };
    const activeEdge = atlasLayout(unlocked).connectors.find((entry) => entry.toId === "rush-1");
    expect(activeEdge.active).toBe(true);
  });

  it("is deterministic across runs", () => {
    const first = atlasLayout(view).nodes.map(({ id, x, y, ring }) => ({ id, x, y, ring }));
    const second = atlasLayout(view).nodes.map(({ id, x, y, ring }) => ({ id, x, y, ring }));
    expect(first).toEqual(second);
  });
});

describe("Skill atlas rendering", () => {
  it("renders a node glyph per node with its state class and a PRO badge for premium", () => {
    const scene = atlasScene(atlasLayout(view));
    expect(scene).toContain('data-node-id="cyclist"');
    expect(scene).toContain("is-unlockable");
    expect(scene).toContain("skill-node-pro");
    expect(scene).toContain("skill-node-icon");
    expect(scene).toContain('data-tier="1"');
  });

  it("labels specialization branches on the map", () => {
    const scene = atlasScene(atlasLayout(view));
    expect(scene).toContain("FLOW");
  });

  it("renders every node, including the synthetic root, as selectable with a hit target", () => {
    const layout = atlasLayout(view);
    const root = layout.nodes.find((entry) => entry.id === SYNTHETIC_ROOT_ID);
    const glyph = nodeGlyph(root);
    expect(glyph).toContain("is-root");
    expect(glyph).toContain('role="button"');
    expect(glyph).toContain('tabindex="0"');
    expect(glyph).toContain("skill-node-hit");
  });
});

describe("Skill atlas tooltip", () => {
  it("summarizes state, requirement progress, cost and reward", () => {
    const premium = view.nodes.find((entry) => entry.id === "flow-hunter");
    const html = tooltipHtml(premium);
    expect(html).toContain("Flow Hunter");
    expect(html).toContain("PRO");
    expect(html).toContain("2 / 10");
    expect(html).toContain("\u25CB"); // unmet marker
    expect(html).toContain("Cost:");
    expect(html).toContain("2 SP");
    expect(html).toContain("Reward:");
    expect(html).toContain("High Flow map filter");
  });

  it("marks met requirements and available state", () => {
    const available = view.nodes.find((entry) => entry.id === "rush-1");
    const html = tooltipHtml(available);
    expect(html).toContain("Available");
    expect(html).toContain("is-met");
    expect(html).toContain("\u2713"); // met marker
  });
});

describe("Skill tree header", () => {
  it("renders the balance and point breakdown in the header", () => {
    const header = SkillTreeHeader(view);
    expect(header).toContain("Skill Points");
    expect(header).toContain("2 spent · 5 earned");
  });
});

describe("Skill node detail", () => {
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

  it("lists the quest chain a quest_unlock node opens", () => {
    const detail = SkillNodeDetail({
      ...view.nodes[1],
      questChain: { title: "Flow quests", quests: [{ title: "Flow quests I", description: "In a single ride: complete 1 Flowline.", xp: 60 }] }
    });
    expect(detail).toContain("QUESTS YOU UNLOCK");
    expect(detail).toContain("Flow quests I");
    expect(detail).toContain("+60 XP");
  });

  it("prompts for a selection when no node is given", () => {
    expect(SkillNodeDetail(null)).toContain("Select a node");
  });
});
