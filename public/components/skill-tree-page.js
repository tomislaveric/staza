import { getAppLocale } from "../app-locales.js";

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

const formatNumber = (value, maximumFractionDigits = 0) => new Intl.NumberFormat(getAppLocale(), {
  maximumFractionDigits
}).format(value);

// Layout geometry for the SVG tree. Columns may be fractional (cross-branch
// nodes sit between branches); rows increase downward. Generous spacing gives
// the tree a designed progression-map feel rather than a dense graph.
const COL_GAP = 216;
const ROW_GAP = 146;
const MARGIN_X = 84;
const MARGIN_Y = 92;
const NODE_RADIUS = 36;

export const nodePosition = (node) => ({
  x: MARGIN_X + node.layout.col * COL_GAP,
  y: MARGIN_Y + node.layout.row * ROW_GAP
});

export const svgDimensions = (nodes) => {
  const positions = nodes.map(nodePosition);
  const maxX = Math.max(0, ...positions.map((position) => position.x)) + MARGIN_X + NODE_RADIUS;
  const maxY = Math.max(0, ...positions.map((position) => position.y)) + MARGIN_Y + NODE_RADIUS;
  return { width: maxX, height: maxY };
};

export const skillTreeViewModel = (view) => {
  const byId = new Map(view.nodes.map((node) => [node.id, node]));
  const connectors = [];
  for (const node of view.nodes) {
    for (const prerequisiteId of node.prerequisites) {
      const prerequisite = byId.get(prerequisiteId);
      if (!prerequisite) continue;
      connectors.push({
        from: nodePosition(prerequisite),
        to: nodePosition(node),
        toId: node.id,
        active: node.state === "unlocked" && prerequisite.state === "unlocked",
        reachable: prerequisite.state === "unlocked"
      });
    }
  }
  return { ...view, connectors, dimensions: svgDimensions(view.nodes) };
};

const Connector = (connector) => {
  const midY = (connector.from.y + connector.to.y) / 2;
  const d = `M ${connector.from.x.toFixed(1)} ${connector.from.y.toFixed(1)}`
    + ` C ${connector.from.x.toFixed(1)} ${midY.toFixed(1)}`
    + ` ${connector.to.x.toFixed(1)} ${midY.toFixed(1)}`
    + ` ${connector.to.x.toFixed(1)} ${connector.to.y.toFixed(1)}`;
  const classes = ["skill-connector"];
  if (connector.active) classes.push("is-active");
  else if (connector.reachable) classes.push("is-reachable");
  return `<path class="${classes.join(" ")}" data-to="${escapeHtml(connector.toId)}" d="${d}" fill="none" />`;
};

// Grant-type iconography drawn in a 24x24 space, centered in each node so the
// tree reads as meaningful capabilities rather than bare numbers.
const NODE_ICONS = {
  tree_access: '<circle cx="12" cy="12" r="8.5" /><path d="M12 5.5 L14.5 12 L12 18.5 L9.5 12 Z" />',
  quest_unlock: '<path d="M6 3.5 V20.5" /><path d="M6 4.5 H17 L14 7.6 L17 10.7 H6" />',
  world_filter: '<circle cx="12" cy="12" r="8.5" /><path d="M3.5 12 H20.5" /><path d="M12 3.5 C8.5 7 8.5 17 12 20.5 C15.5 17 15.5 7 12 3.5" />',
  segment_filter: '<circle cx="6" cy="18" r="2.2" /><circle cx="18" cy="6" r="2.2" /><path d="M7.4 16.6 C9 12 15 12 16.6 7.4" />',
  title: '<circle cx="12" cy="9" r="4.6" /><path d="M9 13.6 L7.2 21 L12 18 L16.8 21 L15 13.6" />',
  badge: '<path d="M12 3.4 L18.8 6 V12 C18.8 16.6 12 20.6 12 20.6 C12 20.6 5.2 16.6 5.2 12 V6 Z" /><path d="M9.3 12 L11.3 14 L15 9.6" />'
};

const TIER_GLYPH = { 1: "I", 2: "II", 3: "III", prestige: "★" };

const NodeGlyph = (node) => {
  const position = nodePosition(node);
  const iconScale = (NODE_RADIUS * 1.08) / 24;
  const iconOffset = (24 * iconScale) / 2;
  const icon = node.state === "unlocked" && node.grant.type !== "badge"
    ? '<path d="M5.5 12.5 L10 17 L18.5 7.5" />'
    : (NODE_ICONS[node.grant.type] ?? '<circle cx="12" cy="12" r="6" />');

  const tierBadge = `
    <g class="skill-node-tier" transform="translate(${(position.x - NODE_RADIUS * 0.72).toFixed(1)} ${(position.y - NODE_RADIUS * 0.72).toFixed(1)})">
      <circle r="11" />
      <text y="0.5">${TIER_GLYPH[node.tier] ?? node.tier}</text>
    </g>`;

  const proBadge = node.premium
    ? `<g class="skill-node-pro" transform="translate(${(position.x + NODE_RADIUS * 0.46).toFixed(1)} ${(position.y - NODE_RADIUS * 0.92).toFixed(1)})">
        <rect x="-15" y="-9" width="30" height="18" rx="9" />
        <text y="0.5">PRO</text>
      </g>`
    : "";

  const costChip = node.state === "unlockable"
    ? `<g class="skill-node-cost-chip" transform="translate(${position.x.toFixed(1)} ${(position.y + NODE_RADIUS + 30).toFixed(1)})">
        <rect x="-26" y="-10" width="52" height="20" rx="10" />
        <text y="0.5">${escapeHtml(formatNumber(node.cost))} SP</text>
      </g>`
    : "";

  return `
    <g class="skill-node is-${node.state}" data-node-id="${escapeHtml(node.id)}" data-tier="${escapeHtml(String(node.tier))}" tabindex="0" role="button"
      aria-label="${escapeHtml(node.name)}">
      <circle class="skill-node-halo" cx="${position.x.toFixed(1)}" cy="${position.y.toFixed(1)}" r="${NODE_RADIUS + 10}" />
      <circle class="skill-node-ring" cx="${position.x.toFixed(1)}" cy="${position.y.toFixed(1)}" r="${(NODE_RADIUS + 4).toFixed(1)}" />
      <circle class="skill-node-circle" cx="${position.x.toFixed(1)}" cy="${position.y.toFixed(1)}" r="${NODE_RADIUS}" />
      <g class="skill-node-icon" transform="translate(${(position.x - iconOffset).toFixed(1)} ${(position.y - iconOffset).toFixed(1)}) scale(${iconScale.toFixed(3)})">${icon}</g>
      ${tierBadge}
      ${proBadge}
      ${costChip}
      <text class="skill-node-label" x="${position.x.toFixed(1)}" y="${(position.y + NODE_RADIUS + 16).toFixed(1)}">${escapeHtml(node.name)}</text>
    </g>
  `;
};

// Branch column headers give the map a sense of place. Positioned above the
// first node of each specialization branch.
const BRANCH_LABELS = { rush: "FLOW", adventure: "EXPLORE", endurance: "DISTANCE" };

const BranchHeaders = (nodes) => {
  const firstByBranch = new Map();
  for (const node of nodes) {
    if (!BRANCH_LABELS[node.branch]) continue;
    const existing = firstByBranch.get(node.branch);
    if (!existing || node.layout.row < existing.layout.row) firstByBranch.set(node.branch, node);
  }
  return [...firstByBranch.values()].map((node) => {
    const position = nodePosition(node);
    return `<text class="skill-branch-label" x="${position.x.toFixed(1)}" y="${(position.y - NODE_RADIUS - 28).toFixed(1)}">${BRANCH_LABELS[node.branch]}</text>`;
  }).join("");
};

export const SkillTreeGraph = (model) => `
  <svg class="skill-tree-graph" viewBox="0 0 ${model.dimensions.width.toFixed(0)} ${model.dimensions.height.toFixed(0)}"
    role="group" aria-label="Skill tree" preserveAspectRatio="xMidYMin meet">
    <g class="skill-connectors">${model.connectors.map(Connector).join("")}</g>
    <g class="skill-branch-headers">${BranchHeaders(model.nodes)}</g>
    <g class="skill-nodes">${model.nodes.map(NodeGlyph).join("")}</g>
  </svg>
`;

export const SkillTreeHeader = (model) => `
  <header class="skill-tree-header">
    <div>
      <h1 id="skill-tree-title">Skill Tree</h1>
      <p>Spend Skill Points to shape your rider</p>
    </div>
    <div class="skill-points" role="status">
      <strong>${formatNumber(model.balance)}</strong>
      <span>Skill Points</span>
      <small>${formatNumber(model.spentPoints)} spent · ${formatNumber(model.earnedPoints)} earned</small>
    </div>
  </header>
`;

const RequirementRow = (requirement) => {
  const percentage = requirement.met
    ? 100
    : requirement.target > 0
      ? Math.max(0, Math.min(100, (requirement.current / requirement.target) * 100))
      : 100;
  const current = formatNumber(requirement.current, requirement.current % 1 === 0 ? 0 : 1);
  const target = formatNumber(requirement.target, requirement.target % 1 === 0 ? 0 : 1);
  const value = requirement.met
    ? '<strong class="skill-requirement-done">Completed</strong>'
    : `<strong>${current} / ${target}</strong>`;
  return `
    <li class="skill-requirement${requirement.met ? " is-met" : ""}">
      <div class="skill-requirement-label"><span>${escapeHtml(requirement.label)}</span>${value}</div>
      <div class="skill-requirement-bar" aria-hidden="true"><i style="width: ${percentage}%"></i></div>
    </li>
  `;
};

const stateLabel = {
  unlocked: "UNLOCKED",
  unlockable: "READY TO UNLOCK",
  premium_locked: "PREMIUM",
  locked: "LOCKED"
};

const GRANT_TYPE_LABEL = {
  badge: "BADGE",
  title: "TITLE",
  quest_unlock: "QUEST",
  world_filter: "MAP FILTER",
  segment_filter: "SEGMENT FILTER",
  tree_access: "BRANCH"
};

export const SkillNodeDetail = (node) => {
  if (!node) {
    return '<aside class="skill-detail skill-detail-empty"><p>Select a node to see its requirements and reward.</p></aside>';
  }
  const prerequisiteNote = node.prerequisites.length && !node.prerequisitesMet
    ? '<p class="skill-detail-hint">Unlock the connected node first.</p>'
    : "";
  const premiumNote = node.state === "premium_locked"
    ? '<p class="skill-detail-hint">This node is part of Premium. Tier 1 stays free.</p>'
    : "";
  const footer = node.state === "unlockable"
    ? `<button class="skill-unlock-button" type="button" data-skill-unlock="${escapeHtml(node.id)}">Unlock · ${formatNumber(node.cost)} SP</button>`
    : node.state === "unlocked"
      ? '<p class="skill-detail-unlocked">Unlocked</p>'
      : `<p class="skill-detail-cost">Cost: <strong>${formatNumber(node.cost)} Skill Points</strong></p>`;
  return `
    <aside class="skill-detail" aria-labelledby="skill-detail-name">
      <span class="skill-detail-state is-${node.state}">${stateLabel[node.state] ?? ""}</span>
      <h2 id="skill-detail-name">${escapeHtml(node.name)}</h2>
      <p class="skill-detail-description">${escapeHtml(node.description)}</p>
      <div class="skill-detail-reward">
        <span class="skill-detail-reward-head">REWARD<i class="skill-grant-tag">${GRANT_TYPE_LABEL[node.grant.type] ?? "REWARD"}</i></span>
        <strong>${escapeHtml(node.grant.label)}</strong>
      </div>
      ${node.requirements.length
        ? `<p class="skill-detail-subhead">REQUIREMENTS</p><ul class="skill-requirements">${node.requirements.map(RequirementRow).join("")}</ul>`
        : '<p class="skill-detail-hint">No progress requirements.</p>'}
      ${prerequisiteNote}
      ${premiumNote}
      <div class="skill-detail-footer">${footer}</div>
    </aside>
  `;
};

export const SkillTreePage = (model, selectedNodeId) => {
  const selected = model.nodes.find((node) => node.id === selectedNodeId);
  return `
    <section class="skill-tree-page" aria-labelledby="skill-tree-title">
      ${SkillTreeHeader(model)}
      <div class="skill-tree-body">
        <div class="skill-tree-canvas">${SkillTreeGraph(model)}</div>
        ${SkillNodeDetail(selected)}
      </div>
    </section>
  `;
};

const responseJson = async (response) => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error ?? "Unable to update the Skill Tree.");
    error.code = body.code;
    throw error;
  }
  return body;
};

export const mountSkillTreePage = async (mountPoint) => {
  mountPoint.innerHTML = '<section class="skill-tree-page"><p class="skill-tree-loading" role="status">Loading Skill Tree...</p></section>';
  let selectedNodeId;
  let justUnlockedId;

  const render = (view) => {
    const model = skillTreeViewModel(view);
    if (!selectedNodeId && model.nodes.length) {
      const firstUnlockable = model.nodes.find((node) => node.state === "unlockable");
      selectedNodeId = (firstUnlockable ?? model.nodes[0]).id;
    }
    mountPoint.innerHTML = SkillTreePage(model, selectedNodeId);
    if (justUnlockedId) {
      const unlocked = mountPoint.querySelector(`.skill-node[data-node-id="${CSS.escape(justUnlockedId)}"]`);
      unlocked?.classList.add("just-unlocked");
      mountPoint
        .querySelectorAll(`.skill-connector[data-to="${CSS.escape(justUnlockedId)}"]`)
        .forEach((connector) => connector.classList.add("just-connected"));
      justUnlockedId = undefined;
    }
  };

  const selectNode = (nodeId) => {
    selectedNodeId = nodeId;
    const current = JSON.parse(mountPoint.dataset.view ?? "null");
    if (current) render(current);
  };

  const store = (view) => {
    mountPoint.dataset.view = JSON.stringify(view);
    render(view);
  };

  mountPoint.addEventListener("click", async (event) => {
    const unlockButton = event.target.closest("[data-skill-unlock]");
    if (unlockButton) {
      const nodeId = unlockButton.dataset.skillUnlock;
      unlockButton.disabled = true;
      unlockButton.textContent = "Unlocking...";
      try {
        const view = await fetch("/api/skill-tree/unlock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nodeId })
        }).then(responseJson);
        justUnlockedId = nodeId;
        selectedNodeId = nodeId;
        store(view);
      } catch (error) {
        const detail = mountPoint.querySelector(".skill-detail");
        if (detail) {
          const notice = document.createElement("p");
          notice.className = "skill-detail-error";
          notice.setAttribute("role", "alert");
          notice.textContent = `Unable to unlock: ${error.message}`;
          detail.appendChild(notice);
        }
      }
      return;
    }
    const nodeGroup = event.target.closest(".skill-node");
    if (nodeGroup?.dataset.nodeId) selectNode(nodeGroup.dataset.nodeId);
  });

  mountPoint.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const nodeGroup = event.target.closest(".skill-node");
    if (nodeGroup?.dataset.nodeId) {
      event.preventDefault();
      selectNode(nodeGroup.dataset.nodeId);
    }
  });

  try {
    const view = await fetch("/api/skill-tree").then(responseJson);
    store(view);
  } catch (error) {
    mountPoint.innerHTML = `<section class="skill-tree-page"><p class="skill-tree-load-error" role="alert">Unable to load Skill Tree: ${escapeHtml(error.message)}</p></section>`;
  }
};
