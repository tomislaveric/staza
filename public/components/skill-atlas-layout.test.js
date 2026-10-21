import { describe, expect, it } from "vitest";
import { atlasLayout, computeRings, ringRadius } from "./skill-atlas-layout.js";
import { SYNTHETIC_ROOT_ID } from "./skill-atlas-visual-config.js";

const node = (overrides) => ({
  sport: "cycling",
  cost: 2,
  premium: false,
  prerequisites: [],
  prerequisitesMet: true,
  requirements: [],
  grant: { type: "quest_unlock", label: "Grant" },
  state: "locked",
  ...overrides
});

// Minimal two-branch tree with a cross-branch node depending on both branches.
const view = {
  nodes: [
    node({ id: "cyclist", name: "Cyclist", branch: "root", tier: 1, state: "unlocked" }),
    node({ id: "rush-1", name: "Rusher I", branch: "rush", tier: 1, prerequisites: ["cyclist"] }),
    node({ id: "rush-2", name: "Rusher II", branch: "rush", tier: 2, premium: true, prerequisites: ["rush-1"] }),
    node({ id: "end-1", name: "Endurance I", branch: "endurance", tier: 1, prerequisites: ["cyclist"] }),
    node({ id: "end-2", name: "Distance Rider", branch: "endurance", tier: 2, premium: true, prerequisites: ["end-1"] }),
    node({ id: "adv-1", name: "Adventurer I", branch: "adventure", tier: 1, prerequisites: ["cyclist"] }),
    node({
      id: "cross",
      name: "Breakaway",
      branch: "cross",
      tier: 3,
      premium: true,
      prerequisites: ["rush-2", "end-2"]
    })
  ]
};

describe("computeRings", () => {
  it("assigns rings by longest prerequisite depth", () => {
    const rings = computeRings(view.nodes);
    expect(rings.get("cyclist")).toBe(1);
    expect(rings.get("rush-1")).toBe(2);
    expect(rings.get("rush-2")).toBe(3);
    expect(rings.get("end-2")).toBe(3);
    // cross depends on two ring-3 nodes, so it lands one ring further out.
    expect(rings.get("cross")).toBe(4);
  });
});

describe("ringRadius", () => {
  it("keeps ring 0 at the center and increases monotonically", () => {
    expect(ringRadius(0)).toBe(0);
    expect(ringRadius(2)).toBeGreaterThan(ringRadius(1));
    expect(ringRadius(4)).toBeGreaterThan(ringRadius(3));
  });
});

describe("atlasLayout angular placement", () => {
  const circularMidpoint = (a, b) => Math.atan2(
    Math.sin(a) + Math.sin(b),
    Math.cos(a) + Math.cos(b)
  );
  const normalize = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

  it("positions a cross node between its contributing branch sectors", () => {
    const layout = atlasLayout(view);
    const byId = new Map(layout.nodes.map((entry) => [entry.id, entry]));
    const rushAngle = byId.get("rush-2").angle;
    const endAngle = byId.get("end-2").angle;
    const crossAngle = byId.get("cross").angle;
    const expected = circularMidpoint(rushAngle, endAngle);
    expect(normalize(crossAngle - expected)).toBeCloseTo(0, 6);
  });

  it("gives distinct branches distinct angles", () => {
    const layout = atlasLayout(view);
    const byId = new Map(layout.nodes.map((entry) => [entry.id, entry]));
    expect(byId.get("rush-1").angle).not.toBeCloseTo(byId.get("end-1").angle, 6);
  });

  it("includes the synthetic root and bounds that contain every node", () => {
    const layout = atlasLayout(view);
    expect(layout.nodes.some((entry) => entry.id === SYNTHETIC_ROOT_ID)).toBe(true);
    for (const entry of layout.nodes) {
      expect(entry.x).toBeGreaterThanOrEqual(layout.bounds.minX);
      expect(entry.x).toBeLessThanOrEqual(layout.bounds.maxX);
      expect(entry.y).toBeGreaterThanOrEqual(layout.bounds.minY);
      expect(entry.y).toBeLessThanOrEqual(layout.bounds.maxY);
    }
  });
});
