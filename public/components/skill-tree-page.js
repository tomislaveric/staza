import { getAppLocale } from "../app-locales.js";
import { atlasLayout } from "./skill-atlas-layout.js";
import { atlasScene } from "./skill-atlas-render.js";
import { createAtlasViewport } from "./skill-atlas-viewport.js";
import { tooltipHtml } from "./skill-atlas-tooltip.js";
import { SYNTHETIC_ROOT_ID } from "./skill-atlas-visual-config.js";

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

const formatNumber = (value, maximumFractionDigits = 0) => new Intl.NumberFormat(getAppLocale(), {
  maximumFractionDigits
}).format(value);

export const SkillTreeHeader = (model) => `
  <header class="skill-tree-header">
    <div>
      <h1 id="skill-tree-title">Skill Atlas</h1>
      <p>Spend Skill Points to shape your athlete across every sport</p>
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
    ? '<p class="skill-detail-hint">This node is part of Premium (cross-sport and late-game progression).</p>'
    : "";
  const questChain = node.questChain
    ? `<p class="skill-detail-subhead">QUESTS YOU UNLOCK</p><ul class="skill-quest-chain">${node.questChain.quests.map((quest) =>
      `<li><strong>${escapeHtml(quest.title)}</strong> <span>${escapeHtml(quest.description)}</span> <em>+${formatNumber(quest.xp)} XP</em></li>`).join("")}</ul>`
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
      ${questChain}
      ${prerequisiteNote}
      ${premiumNote}
      <div class="skill-detail-footer">${footer}</div>
    </aside>
  `;
};

export const SkillTreePage = () => `
  <section class="skill-tree-page" aria-labelledby="skill-tree-title">
    <div class="skill-tree-header-slot"></div>
    <div class="skill-tree-body">
      <div class="skill-tree-canvas"></div>
      <div class="skill-detail-slot"></div>
    </div>
  </section>
`;

const responseJson = async (response) => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error ?? "Unable to update the Skill Atlas.");
    error.code = body.code;
    throw error;
  }
  return body;
};

export const mountSkillTreePage = async (mountPoint) => {
  mountPoint.innerHTML = '<section class="skill-tree-page"><p class="skill-tree-loading" role="status">Loading Skill Atlas...</p></section>';

  let view;
  let layout;
  let selectedNodeId;
  let viewport;
  let canvasHost;
  let detailSlot;
  let headerSlot;
  let tooltipEl;

  const canHover = globalThis.matchMedia?.("(hover: hover)").matches ?? false;

  const detailNodeById = (id) => layout?.byId.get(id);

  const hideTooltip = () => {
    if (tooltipEl) tooltipEl.hidden = true;
  };

  const positionTooltip = (node) => {
    if (!tooltipEl || !viewport) return;
    const center = viewport.worldToScreen(node.x, node.y);
    const nodeScreenRadius = node.radius * viewport.state.k;
    const vpWidth = viewport.element.clientWidth;
    const vpHeight = viewport.element.clientHeight;
    const width = tooltipEl.offsetWidth;
    const height = tooltipEl.offsetHeight;
    const margin = 8;

    let left = center.x - width / 2;
    let top = center.y - nodeScreenRadius - 12 - height;
    if (top < margin) top = center.y + nodeScreenRadius + 12; // flip below near the top edge
    left = Math.min(Math.max(margin, left), Math.max(margin, vpWidth - width - margin));
    top = Math.min(Math.max(margin, top), Math.max(margin, vpHeight - height - margin));
    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
  };

  const showTooltip = (nodeId) => {
    const node = detailNodeById(nodeId);
    if (!node || !tooltipEl) return;
    tooltipEl.innerHTML = tooltipHtml(node);
    tooltipEl.hidden = false;
    positionTooltip(node);
  };

  const renderDetail = () => {
    if (!detailSlot) return;
    detailSlot.innerHTML = SkillNodeDetail(detailNodeById(selectedNodeId));
  };

  const highlightSelection = () => {
    canvasHost?.querySelectorAll(".skill-node.is-selected")
      .forEach((node) => node.classList.remove("is-selected"));
    if (!selectedNodeId) return;
    canvasHost
      ?.querySelector(`.skill-node[data-node-id="${CSS.escape(selectedNodeId)}"]`)
      ?.classList.add("is-selected");
  };

  const selectNode = (nodeId) => {
    selectedNodeId = nodeId;
    renderDetail();
    highlightSelection();
  };

  const focusNode = (nodeId) => {
    const node = detailNodeById(nodeId);
    if (node && viewport) viewport.focusNode(node.x, node.y);
  };

  let hasRenderedScene = false;
  const renderScene = ({ keepView = false } = {}) => {
    hideTooltip();
    layout = atlasLayout(view);
    const initial = !hasRenderedScene && !keepView;
    viewport.setScene(atlasScene(layout), layout.bounds, { keepView, initial });
    hasRenderedScene = true;
    highlightSelection();
  };

  const defaultSelection = () => {
    const firstUnlockable = view.nodes.find((node) => node.state === "unlockable");
    return (firstUnlockable ?? view.nodes[0])?.id;
  };

  const flashUnlock = (nodeId) => {
    const unlocked = canvasHost?.querySelector(`.skill-node[data-node-id="${CSS.escape(nodeId)}"]`);
    unlocked?.classList.add("just-unlocked");
    canvasHost
      ?.querySelectorAll(`.skill-connector[data-to="${CSS.escape(nodeId)}"]`)
      .forEach((connector) => connector.classList.add("just-connected"));
  };

  const unlock = async (nodeId, button) => {
    button.disabled = true;
    button.textContent = "Unlocking...";
    try {
      view = await fetch("/api/skill-tree/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId })
      }).then(responseJson);
      selectedNodeId = nodeId;
      renderScene({ keepView: true });
      renderDetail();
      flashUnlock(nodeId);
    } catch (error) {
      const notice = document.createElement("p");
      notice.className = "skill-detail-error";
      notice.setAttribute("role", "alert");
      notice.textContent = `Unable to unlock: ${error.message}`;
      detailSlot?.querySelector(".skill-detail")?.appendChild(notice);
      button.disabled = false;
      button.textContent = `Unlock · ${formatNumber(detailNodeById(nodeId)?.cost ?? 0)} SP`;
    }
  };

  const build = () => {
    mountPoint.innerHTML = SkillTreePage();
    headerSlot = mountPoint.querySelector(".skill-tree-header-slot");
    canvasHost = mountPoint.querySelector(".skill-tree-canvas");
    detailSlot = mountPoint.querySelector(".skill-detail-slot");
    headerSlot.innerHTML = SkillTreeHeader(view);
    viewport = createAtlasViewport(canvasHost);

    tooltipEl = document.createElement("div");
    tooltipEl.className = "atlas-tooltip";
    tooltipEl.setAttribute("role", "tooltip");
    tooltipEl.hidden = true;
    viewport.element.appendChild(tooltipEl);

    canvasHost.addEventListener("click", (event) => {
      const nodeGroup = event.target.closest(".skill-node");
      if (nodeGroup?.dataset.nodeId) selectNode(nodeGroup.dataset.nodeId);
    });

    canvasHost.addEventListener("dblclick", (event) => {
      const nodeGroup = event.target.closest(".skill-node");
      if (nodeGroup?.dataset.nodeId) focusNode(nodeGroup.dataset.nodeId);
    });

    canvasHost.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const nodeGroup = event.target.closest(".skill-node");
      if (nodeGroup?.dataset.nodeId) {
        event.preventDefault();
        selectNode(nodeGroup.dataset.nodeId);
        focusNode(nodeGroup.dataset.nodeId);
      }
    });

    // Keyboard focus mirrors the hover preview; pointer hover only where supported.
    canvasHost.addEventListener("focusin", (event) => {
      const nodeGroup = event.target.closest(".skill-node");
      if (nodeGroup?.dataset.nodeId) showTooltip(nodeGroup.dataset.nodeId);
    });
    canvasHost.addEventListener("focusout", (event) => {
      const nodeGroup = event.target.closest(".skill-node");
      const next = event.relatedTarget?.closest?.(".skill-node");
      if (nodeGroup && next !== nodeGroup) hideTooltip();
    });

    if (canHover) {
      canvasHost.addEventListener("pointerover", (event) => {
        if (event.pointerType && event.pointerType !== "mouse") return;
        const nodeGroup = event.target.closest(".skill-node");
        if (nodeGroup?.dataset.nodeId) showTooltip(nodeGroup.dataset.nodeId);
      });
      canvasHost.addEventListener("pointerout", (event) => {
        const nodeGroup = event.target.closest(".skill-node");
        const next = event.relatedTarget?.closest?.(".skill-node");
        if (nodeGroup && next !== nodeGroup) hideTooltip();
      });
    }

    // Any pan/zoom gesture dismisses the preview so it never fights the viewport.
    canvasHost.addEventListener("pointerdown", hideTooltip);
    canvasHost.addEventListener("wheel", hideTooltip, { passive: true });

    detailSlot.addEventListener("click", (event) => {
      const unlockButton = event.target.closest("[data-skill-unlock]");
      if (unlockButton) unlock(unlockButton.dataset.skillUnlock, unlockButton);
    });
  };

  try {
    view = await fetch("/api/skill-tree").then(responseJson);
    build();
    selectedNodeId = defaultSelection();
    renderScene();
    renderDetail();
  } catch (error) {
    mountPoint.innerHTML = `<section class="skill-tree-page"><p class="skill-tree-load-error" role="alert">Unable to load Skill Atlas: ${escapeHtml(error.message)}</p></section>`;
  }
};
