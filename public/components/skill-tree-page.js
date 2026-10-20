import { getAppLocale } from "../app-locales.js";

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

const formatNumber = (value, maximumFractionDigits = 0) => new Intl.NumberFormat(getAppLocale(), {
  maximumFractionDigits
}).format(value);

// Layout geometry for the SVG tree. Columns may be fractional (cross-branch
// nodes sit between branches); rows increase downward.
const COL_GAP = 150;
const ROW_GAP = 112;
const MARGIN_X = 54;
const MARGIN_Y = 52;
const NODE_RADIUS = 26;

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
        active: node.state === "unlocked" && prerequisite.state === "unlocked"
      });
    }
  }
  return { ...view, connectors, dimensions: svgDimensions(view.nodes) };
};

const Connector = (connector) => `
  <line class="skill-connector${connector.active ? " is-active" : ""}"
    x1="${connector.from.x.toFixed(1)}" y1="${connector.from.y.toFixed(1)}"
    x2="${connector.to.x.toFixed(1)}" y2="${connector.to.y.toFixed(1)}" />
`;

const NodeGlyph = (node) => {
  const position = nodePosition(node);
  const premiumMark = node.premium
    ? `<text class="skill-node-premium" x="${(position.x + NODE_RADIUS - 4).toFixed(1)}" y="${(position.y - NODE_RADIUS + 10).toFixed(1)}">★</text>`
    : "";
  return `
    <g class="skill-node is-${node.state}" data-node-id="${escapeHtml(node.id)}" tabindex="0" role="button"
      aria-label="${escapeHtml(node.name)}">
      <circle class="skill-node-halo" cx="${position.x.toFixed(1)}" cy="${position.y.toFixed(1)}" r="${NODE_RADIUS + 8}" />
      <circle class="skill-node-circle" cx="${position.x.toFixed(1)}" cy="${position.y.toFixed(1)}" r="${NODE_RADIUS}" />
      <text class="skill-node-cost" x="${position.x.toFixed(1)}" y="${(position.y + 5).toFixed(1)}">${node.state === "unlocked" ? "✓" : formatNumber(node.cost)}</text>
      ${premiumMark}
      <text class="skill-node-label" x="${position.x.toFixed(1)}" y="${(position.y + NODE_RADIUS + 16).toFixed(1)}">${escapeHtml(node.name)}</text>
    </g>
  `;
};

export const SkillTreeGraph = (model) => `
  <svg class="skill-tree-graph" viewBox="0 0 ${model.dimensions.width.toFixed(0)} ${model.dimensions.height.toFixed(0)}"
    role="group" aria-label="Skill tree" preserveAspectRatio="xMidYMin meet">
    <g class="skill-connectors">${model.connectors.map(Connector).join("")}</g>
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
  const percentage = requirement.target > 0
    ? Math.max(0, Math.min(100, (requirement.current / requirement.target) * 100))
    : 100;
  const current = formatNumber(requirement.current, requirement.current % 1 === 0 ? 0 : 1);
  const target = formatNumber(requirement.target, requirement.target % 1 === 0 ? 0 : 1);
  return `
    <li class="skill-requirement${requirement.met ? " is-met" : ""}">
      <div class="skill-requirement-label"><span>${escapeHtml(requirement.label)}</span><strong>${current} / ${target}</strong></div>
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
  const unlockButton = node.state === "unlockable"
    ? `<button class="skill-unlock-button" type="button" data-skill-unlock="${escapeHtml(node.id)}">Unlock · ${formatNumber(node.cost)} SP</button>`
    : node.state === "unlocked"
      ? '<p class="skill-detail-unlocked">Unlocked</p>'
      : "";
  return `
    <aside class="skill-detail" aria-labelledby="skill-detail-name">
      <span class="skill-detail-state is-${node.state}">${stateLabel[node.state] ?? ""}</span>
      <h2 id="skill-detail-name">${escapeHtml(node.name)}</h2>
      <p class="skill-detail-description">${escapeHtml(node.description)}</p>
      <p class="skill-detail-reward"><span>REWARD</span>${escapeHtml(node.grant.label)}</p>
      ${node.requirements.length
        ? `<ul class="skill-requirements">${node.requirements.map(RequirementRow).join("")}</ul>`
        : '<p class="skill-detail-hint">No progress requirements.</p>'}
      ${prerequisiteNote}
      ${premiumNote}
      <p class="skill-detail-cost">Cost: <strong>${formatNumber(node.cost)} Skill Points</strong></p>
      ${unlockButton}
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
