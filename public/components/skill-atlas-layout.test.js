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

describe("multi-sport atlas placement", () => {
  const normalize = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
  const circularMidpoint = (a, b) => Math.atan2(
    Math.sin(a) + Math.sin(b),
    Math.cos(a) + Math.cos(b)
  );

  const multiSportView = {
    nodes: [
      node({ id: "cyclist", name: "Cycling", sport: "cycling", branch: "root", tier: 1, state: "unlocked" }),
      node({ id: "cyc-end-1", name: "Endurance I", sport: "cycling", branch: "endurance", tier: 1, prerequisites: ["cyclist"] }),
      node({ id: "runner", name: "Running", sport: "running", branch: "root", tier: 1, state: "unlocked" }),
      node({ id: "run-end-1", name: "Runner Endurance I", sport: "running", branch: "endurance", tier: 1, prerequisites: ["runner"] }),
      node({ id: "hiker", name: "Hiking", sport: "hiking", branch: "root", tier: 1, state: "unlocked" }),
      node({ id: "hike-sum-1", name: "Summit I", sport: "hiking", branch: "summit", tier: 1, prerequisites: ["hiker"] }),
      node({
        id: "xs-dual",
        name: "Dual Athlete",
        sport: "running",
        branch: "cross_sport",
        tier: 3,
        premium: true,
        prerequisites: ["cyc-end-1", "run-end-1"]
      })
    ]
  };

  it("splits the circle into one sector per sport", () => {
    const layout = atlasLayout(multiSportView);
    const byId = new Map(layout.nodes.map((entry) => [entry.id, entry]));
    const cycling = byId.get("cyclist").angle;
    const running = byId.get("runner").angle;
    const hiking = byId.get("hiker").angle;
    const third = (2 * Math.PI) / 3;
    expect(Math.abs(normalize(running - cycling))).toBeCloseTo(third, 5);
    expect(Math.abs(normalize(hiking - running))).toBeCloseTo(third, 5);
  });

  it("places a cross-sport node between the sports it connects", () => {
    const layout = atlasLayout(multiSportView);
    const byId = new Map(layout.nodes.map((entry) => [entry.id, entry]));
    const expected = circularMidpoint(byId.get("cyc-end-1").angle, byId.get("run-end-1").angle);
    expect(normalize(byId.get("xs-dual").angle - expected)).toBeCloseTo(0, 6);
  });

  it("emits a connector for every prerequisite of a multi-parent node", () => {
    const layout = atlasLayout(multiSportView);
    const incoming = layout.connectors.filter((connector) => connector.toId === "xs-dual");
    expect(incoming.length).toBe(2);
  });

  it("fans apart nodes that resolve to the same ring and angle", () => {
    // Two cross-sport nodes with identical prerequisite angles would otherwise
    // stack exactly on top of each other (overlapping titles).
    const overlapping = {
      nodes: [
        node({ id: "cyclist", name: "Cycling", sport: "cycling", branch: "root", tier: 1 }),
        node({ id: "runner", name: "Running", sport: "running", branch: "root", tier: 1 }),
        node({ id: "cyc-1", name: "Cyc I", sport: "cycling", branch: "endurance", tier: 1, prerequisites: ["cyclist"] }),
        node({ id: "run-1", name: "Run I", sport: "running", branch: "endurance", tier: 1, prerequisites: ["runner"] }),
        node({ id: "xs-a", name: "Dual A", sport: "cycling", branch: "cross_sport", tier: 3, premium: true, prerequisites: ["cyc-1", "run-1"] }),
        node({ id: "xs-b", name: "Dual B", sport: "running", branch: "cross_sport", tier: 3, premium: true, prerequisites: ["cyc-1", "run-1"] })
      ]
    };
    const layout = atlasLayout(overlapping);
    const byId = new Map(layout.nodes.map((entry) => [entry.id, entry]));
    const a = byId.get("xs-a");
    const b = byId.get("xs-b");
    expect(a.ring).toBe(b.ring);
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    expect(distance).toBeGreaterThan(80);
  });
});
