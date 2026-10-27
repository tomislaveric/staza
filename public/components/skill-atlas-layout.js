// Deterministic radial layout for the Skill Atlas. Pure and side-effect free:
// given the server view, it derives polar coordinates client-side from tree
// structure (sport, branch, prerequisite depth) and returns positioned nodes
// plus connectors. Polar coordinates are never persisted and the catalog
// `layout:{col,row}` is intentionally ignored here.

import {
  BRANCH_ORDER,
  CROSS_BRANCHES,
  NODE_SIZES,
  RING_RADII,
  SPORT_ORDER,
  SYNTHETIC_ROOT_ID
} from "./skill-atlas-visual-config.js";

// Rotate the whole composition so the first sport reads from the top rather
// than the right, giving a more intentional constellation.
const ANGLE_OFFSET = -Math.PI / 2;

// Visual role drives node sizing and styling. Cross-branch, cross-sport, and
// prestige nodes read distinctly from ordinary branch nodes while staying within
// one coherent system.
const roleForNode = (node) => {
  if (node.id === SYNTHETIC_ROOT_ID) return "root";
  if (node.branch === "root") return "sport";
  if (node.branch === "cross_sport") return "crossSport";
  if (node.tier === "prestige") return "prestige";
  if (node.branch === "cross") return "crossBranch";
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
      realNodes.filter((node) => node.sport === sport && node.branch !== "root" && !CROSS_BRANCHES.has(node.branch))
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
    } else if (CROSS_BRANCHES.has(node.branch)) {
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

// Minimum arc (in world units) kept between two node centers on the same ring so
// their labels never stack. Converted to an angle per-ring from the ring radius.
const MIN_LABEL_ARC = 150;

/**
 * Deterministic declutter: nodes that resolve to (almost) the same angle on the
 * same ring — common for cross-sport / prestige nodes placed by the circular
 * mean of their parents — are fanned apart so their titles never overlap. Uses a
 * symmetric circular relaxation (wrap-around aware) that preserves the ring's
 * overall balance. Deterministic: identical angles break ties by node id.
 */
const TWO_PI = Math.PI * 2;
// Signed shortest angular distance from a to b, in (-π, π].
const circularDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

const declutterAngles = (nodes, rings, angles) => {
  const byRing = new Map();
  for (const node of nodes) {
    if (node.id === SYNTHETIC_ROOT_ID) continue;
    const ring = rings.get(node.id);
    if (!ring) continue; // skip ring 0 / unresolved
    if (!byRing.has(ring)) byRing.set(ring, []);
    byRing.get(ring).push(node.id);
  }

  for (const [ring, ids] of byRing) {
    if (ids.length < 2) continue;
    const radius = ringRadius(ring);
    if (radius <= 0) continue;
    // Target separation: the arc a label needs, capped at an even spread so a
    // full ring can always fit (n * minGap <= 2π).
    const minGap = Math.min(TWO_PI / ids.length, MIN_LABEL_ARC / radius);

    // Stable order so tie-breaks (identical angles) are deterministic.
    const ordered = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const current = new Map(ordered.map((id) => [id, angles.get(id) ?? 0]));

    for (let pass = 0; pass < 60; pass += 1) {
      let moved = false;
      for (let i = 0; i < ordered.length; i += 1) {
        for (let j = i + 1; j < ordered.length; j += 1) {
          const a = ordered[i];
          const b = ordered[j];
          let delta = circularDelta(current.get(a), current.get(b));
          // Identical angles: nudge in a fixed direction (ids are sorted, so i<j).
          if (Math.abs(delta) < 1e-6) delta = minGap * 0.5;
          const gap = Math.abs(delta);
          if (gap >= minGap) continue;
          const push = (minGap - gap) / 2 + 1e-4;
          const dir = delta >= 0 ? 1 : -1;
          current.set(b, current.get(b) + dir * push);
          current.set(a, current.get(a) - dir * push);
          moved = true;
        }
      }
      if (!moved) break;
    }

    for (const id of ordered) angles.set(id, current.get(id));
  }

  return angles;
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
  declutterAngles(nodes, rings, angles);

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
