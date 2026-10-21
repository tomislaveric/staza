// Deterministic radial layout for the Skill Atlas. Pure and side-effect free:
// given the server view, it derives polar coordinates client-side from tree
// structure (sport, branch, prerequisite depth) and returns positioned nodes
// plus connectors. Polar coordinates are never persisted and the catalog
// `layout:{col,row}` is intentionally ignored here.

import {
  BRANCH_ORDER,
  NODE_SIZES,
  RING_RADII,
  SPORT_ORDER,
  SYNTHETIC_ROOT_ID
} from "./skill-atlas-visual-config.js";

// Rotate the whole composition so the first sport reads from the top rather
// than the right, giving a more intentional constellation.
const ANGLE_OFFSET = -Math.PI / 2;

const roleForNode = (node) => {
  if (node.id === SYNTHETIC_ROOT_ID) return "root";
  if (node.branch === "root") return "sport";
  return "skill";
};

// Radius for a ring index: ring 0 at the center, ring 1 at `first`, and every
// further ring a fixed `step` outward.
export const ringRadius = (ring) =>
  ring <= 0 ? RING_RADII.base : RING_RADII.first + (ring - 1) * RING_RADII.step;

/**
 * Progression depth per node = longest prerequisite path from a sport root,
 * with the synthetic root at ring 0 and sport roots at ring 1. Memoized DFS so
 * nodes sharing a progression depth land on the same concentric ring.
 */
export const computeRings = (nodes) => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const rings = new Map();
  const depth = (id, seen = new Set()) => {
    if (rings.has(id)) return rings.get(id);
    const node = byId.get(id);
    if (!node || seen.has(id)) return 1;
    seen.add(id);
    const prerequisites = node.prerequisites ?? [];
    const ring = prerequisites.length === 0
      ? 1
      : 1 + Math.max(...prerequisites.map((prerequisiteId) => depth(prerequisiteId, seen)));
    rings.set(id, ring);
    return ring;
  };
  for (const node of nodes) depth(node.id);
  return rings;
};

// Circular mean of angles, so "between" placements are taken the short way
// around the circle (and cross-branch / cross-sport nodes sit between sectors).
const circularMean = (angles, fallback) => {
  if (!angles.length) return fallback;
  const x = angles.reduce((sum, angle) => sum + Math.cos(angle), 0);
  const y = angles.reduce((sum, angle) => sum + Math.sin(angle), 0);
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return fallback;
  return Math.atan2(y, x);
};

const orderedPresent = (values, order) => {
  const present = new Set(values);
  const known = order.filter((value) => present.has(value));
  const extra = [...present].filter((value) => !order.includes(value)).sort();
  return [...known, ...extra];
};

/**
 * Assign a base angle to each sport sector and each branch within it. Sports
 * present in the data split the full circle (so Cycling fills it alone today);
 * branches fan across their sport sector. Sport roots sit at the sector's
 * leading edge so a branch never collides with the root's own spoke.
 */
const computeAngles = (nodes) => {
  const realNodes = nodes.filter((node) => node.id !== SYNTHETIC_ROOT_ID);
  const sports = orderedPresent(realNodes.map((node) => node.sport), SPORT_ORDER);
  const sportSpan = (2 * Math.PI) / Math.max(1, sports.length);

  const sportStart = new Map(sports.map((sport, index) => [sport, ANGLE_OFFSET + index * sportSpan]));
  const branchAngle = new Map(); // key `${sport}:${branch}` -> angle

  for (const sport of sports) {
    const branches = orderedPresent(
      realNodes.filter((node) => node.sport === sport && node.branch !== "root" && node.branch !== "cross")
        .map((node) => node.branch),
      BRANCH_ORDER
    );
    const count = Math.max(1, branches.length);
    branches.forEach((branch, index) => {
      const fraction = (index + 0.5) / count;
      branchAngle.set(`${sport}:${branch}`, sportStart.get(sport) + fraction * sportSpan);
    });
  }

  const byId = new Map(realNodes.map((node) => [node.id, node]));
  const angleCache = new Map();
  const angleFor = (node, seen = new Set()) => {
    if (angleCache.has(node.id)) return angleCache.get(node.id);
    if (seen.has(node.id)) return sportStart.get(node.sport) ?? ANGLE_OFFSET;
    seen.add(node.id);

    let angle;
    if (node.branch === "root") {
      angle = sportStart.get(node.sport) ?? ANGLE_OFFSET;
    } else if (node.branch === "cross") {
      const parentAngles = (node.prerequisites ?? [])
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((parent) => angleFor(parent, seen));
      angle = circularMean(parentAngles, sportStart.get(node.sport) ?? ANGLE_OFFSET);
    } else {
      angle = branchAngle.get(`${node.sport}:${node.branch}`)
        ?? sportStart.get(node.sport) ?? ANGLE_OFFSET;
    }
    angleCache.set(node.id, angle);
    return angle;
  };

  const result = new Map();
  for (const node of realNodes) result.set(node.id, angleFor(node));
  return result;
};

const syntheticRoot = () => ({
  id: SYNTHETIC_ROOT_ID,
  name: "Athlete",
  description: "The origin of your progression. Every sport branches out from here.",
  sport: null,
  branch: "root",
  tier: null,
  cost: 0,
  premium: false,
  grant: { type: "tree_access", label: "Your athlete origin" },
  prerequisites: [],
  requirements: [],
  requirementsMet: true,
  prerequisitesMet: true,
  affordable: true,
  state: "unlocked",
  synthetic: true
});

/**
 * Build the positioned radial layout. Returns nodes (including the synthetic
 * root), connectors, and the content bounds used for fit/center.
 */
export const atlasLayout = (view) => {
  const root = syntheticRoot();
  const nodes = [root, ...view.nodes];

  const rings = computeRings(view.nodes);
  rings.set(SYNTHETIC_ROOT_ID, 0);
  const angles = computeAngles(nodes);
  angles.set(SYNTHETIC_ROOT_ID, 0);

  const positioned = nodes.map((node) => {
    const ring = rings.get(node.id) ?? 1;
    const angle = angles.get(node.id) ?? 0;
    const radius = ringRadius(ring);
    return {
      ...node,
      ring,
      angle,
      radius: NODE_SIZES[roleForNode(node)] ?? NODE_SIZES.skill,
      role: roleForNode(node),
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius
    };
  });

  const byId = new Map(positioned.map((node) => [node.id, node]));
  const connectors = [];
  const pushConnector = (from, to) => {
    if (!from || !to) return;
    connectors.push({
      fromId: from.id,
      toId: to.id,
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      active: from.state === "unlocked" && to.state === "unlocked",
      reachable: from.state === "unlocked"
    });
  };

  for (const node of positioned) {
    if (node.id === SYNTHETIC_ROOT_ID) continue;
    if (node.branch === "root") {
      pushConnector(byId.get(SYNTHETIC_ROOT_ID), node);
      continue;
    }
    for (const prerequisiteId of node.prerequisites ?? []) {
      pushConnector(byId.get(prerequisiteId), node);
    }
  }

  const bounds = positioned.reduce(
    (acc, node) => {
      const reach = (node.radius ?? NODE_SIZES.skill) + 48;
      acc.minX = Math.min(acc.minX, node.x - reach);
      acc.minY = Math.min(acc.minY, node.y - reach);
      acc.maxX = Math.max(acc.maxX, node.x + reach);
      acc.maxY = Math.max(acc.maxY, node.y + reach);
      return acc;
    },
    { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  );

  return { nodes: positioned, connectors, bounds, byId };
};
