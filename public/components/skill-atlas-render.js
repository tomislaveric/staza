// Radial SVG rendering for the Skill Atlas. Consumes the positioned layout and
// visual config and returns SVG markup for the pannable world group: curved
// progression connectors, sport/branch sector labels, and node glyphs. State
// semantics and iconography are preserved from the original tree.

import { getAppLocale } from "../app-locales.js";
import {
  BRANCH_LABELS,
  SYNTHETIC_ROOT_ID,
  sportVisual
} from "./skill-atlas-visual-config.js";

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

const formatNumber = (value, maximumFractionDigits = 0) => new Intl.NumberFormat(getAppLocale(), {
  maximumFractionDigits
}).format(value);

const n = (value) => Number(value).toFixed(1);

// Grant-type iconography drawn in a 24x24 space so nodes read as meaningful
// capabilities rather than bare numbers.
const NODE_ICONS = {
  tree_access: '<circle cx="12" cy="12" r="8.5" /><path d="M12 5.5 L14.5 12 L12 18.5 L9.5 12 Z" />',
  quest_unlock: '<path d="M6 3.5 V20.5" /><path d="M6 4.5 H17 L14 7.6 L17 10.7 H6" />',
  world_filter: '<circle cx="12" cy="12" r="8.5" /><path d="M3.5 12 H20.5" /><path d="M12 3.5 C8.5 7 8.5 17 12 20.5 C15.5 17 15.5 7 12 3.5" />',
  segment_filter: '<circle cx="6" cy="18" r="2.2" /><circle cx="18" cy="6" r="2.2" /><path d="M7.4 16.6 C9 12 15 12 16.6 7.4" />',
  title: '<circle cx="12" cy="9" r="4.6" /><path d="M9 13.6 L7.2 21 L12 18 L16.8 21 L15 13.6" />',
  badge: '<path d="M12 3.4 L18.8 6 V12 C18.8 16.6 12 20.6 12 20.6 C12 20.6 5.2 16.6 5.2 12 V6 Z" /><path d="M9.3 12 L11.3 14 L15 9.6" />'
};

// Root landmark: a compass star rather than a grant icon.
const ROOT_ICON = '<path d="M12 2.5 L13.6 10.4 L21.5 12 L13.6 13.6 L12 21.5 L10.4 13.6 L2.5 12 L10.4 10.4 Z" />';

const TIER_GLYPH = { 1: "I", 2: "II", 3: "III", prestige: "★" };

// Curved connector bending gently toward the center for an organic, radial feel.
export const connectorPath = (connector) => {
  const midX = (connector.from.x + connector.to.x) / 2;
  const midY = (connector.from.y + connector.to.y) / 2;
  const curve = 0.14; // pull the control point toward the origin
  const cx = midX * (1 - curve);
  const cy = midY * (1 - curve);
  const d = `M ${n(connector.from.x)} ${n(connector.from.y)}`
    + ` Q ${n(cx)} ${n(cy)} ${n(connector.to.x)} ${n(connector.to.y)}`;
  const classes = ["skill-connector"];
  if (connector.active) classes.push("is-active");
  else if (connector.reachable) classes.push("is-reachable");
  return `<path class="${classes.join(" ")}" data-to="${escapeHtml(connector.toId)}" d="${d}" fill="none" />`;
};

export const nodeGlyph = (node) => {
  const r = node.radius;
  const accent = node.sport ? sportVisual(node.sport).accent : "var(--accent-yellow-bright)";

  const iconScale = (r * 1.08) / 24;
  const iconOffset = (24 * iconScale) / 2;
  const icon = node.role === "root"
    ? ROOT_ICON
    : node.state === "unlocked" && node.grant?.type !== "badge"
      ? '<path d="M5.5 12.5 L10 17 L18.5 7.5" />'
      : (NODE_ICONS[node.grant?.type] ?? '<circle cx="12" cy="12" r="6" />');

  const tierBadge = node.tier
    ? `<g class="skill-node-tier" transform="translate(${n(node.x - r * 0.72)} ${n(node.y - r * 0.72)})">
        <circle r="11" />
        <text y="0.5">${TIER_GLYPH[node.tier] ?? node.tier}</text>
      </g>`
    : "";

  const proBadge = node.premium
    ? `<g class="skill-node-pro" transform="translate(${n(node.x + r * 0.46)} ${n(node.y - r * 0.92)})">
        <rect x="-15" y="-9" width="30" height="18" rx="9" />
        <text y="0.5">PRO</text>
      </g>`
    : "";

  const costChip = node.state === "unlockable"
    ? `<g class="skill-node-cost-chip" transform="translate(${n(node.x)} ${n(node.y + r + 26)})">
        <rect x="-26" y="-10" width="52" height="20" rx="10" />
        <text y="0.5">${escapeHtml(formatNumber(node.cost))} SP</text>
      </g>`
    : "";

  // Generous invisible hit target so nodes stay easy to select when zoomed out,
  // without enlarging the visible node.
  const hitRadius = r + 26;

  return `
    <g class="skill-node is-${node.state} is-${node.role}" data-node-id="${escapeHtml(node.id)}"
      data-tier="${escapeHtml(String(node.tier ?? ""))}" data-role="${escapeHtml(node.role)}"
      style="--sport-accent: ${accent};"
      tabindex="0" role="button"
      aria-label="${escapeHtml(node.name)}">
      <circle class="skill-node-hit" cx="${n(node.x)}" cy="${n(node.y)}" r="${n(hitRadius)}" />
      <circle class="skill-node-halo" cx="${n(node.x)}" cy="${n(node.y)}" r="${n(r + 10)}" />
      <circle class="skill-node-ring" cx="${n(node.x)}" cy="${n(node.y)}" r="${n(r + 4)}" />
      <circle class="skill-node-circle" cx="${n(node.x)}" cy="${n(node.y)}" r="${n(r)}" />
      <g class="skill-node-icon" transform="translate(${n(node.x - iconOffset)} ${n(node.y - iconOffset)}) scale(${iconScale.toFixed(3)})">${icon}</g>
      ${tierBadge}
      ${proBadge}
      ${costChip}
      <text class="skill-node-label" x="${n(node.x)}" y="${n(node.y + r + 17)}">${escapeHtml(node.name)}</text>
    </g>
  `;
};

// Branch sector labels placed just beyond the outermost node of each branch,
// along the branch's own angle, giving the map a sense of place.
export const sectorLabels = (nodes) => {
  const outermost = new Map();
  for (const node of nodes) {
    if (!BRANCH_LABELS[node.branch]) continue;
    const key = `${node.sport}:${node.branch}`;
    const existing = outermost.get(key);
    if (!existing || node.ring > existing.ring) outermost.set(key, node);
  }
  return [...outermost.values()].map((node) => {
    const distance = Math.hypot(node.x, node.y) + node.radius + 34;
    const angle = Math.atan2(node.y, node.x);
    const lx = Math.cos(angle) * distance;
    const ly = Math.sin(angle) * distance;
    return `<text class="skill-branch-label" x="${n(lx)}" y="${n(ly)}">${BRANCH_LABELS[node.branch]}</text>`;
  }).join("");
};

// Inner world group that the viewport pans and zooms via a transform.
export const atlasScene = (layout) => `
  <g class="atlas-world">
    <g class="skill-connectors">${layout.connectors.map(connectorPath).join("")}</g>
    <g class="skill-branch-headers">${sectorLabels(layout.nodes)}</g>
    <g class="skill-nodes">${layout.nodes.map(nodeGlyph).join("")}</g>
  </g>
`;

export { SYNTHETIC_ROOT_ID };
