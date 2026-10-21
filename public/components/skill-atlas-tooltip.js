// Compact hover/focus preview for Skill Atlas nodes. Renders a small summary
// (name, state, requirement progress, cost, reward) that complements — rather
// than duplicates — the full detail panel. Pure markup; positioning and
// show/hide are handled by the page against the viewport.

import { getAppLocale } from "../app-locales.js";

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

const formatNumber = (value, maximumFractionDigits = 0) => new Intl.NumberFormat(getAppLocale(), {
  maximumFractionDigits
}).format(value);

const STATE_WORD = {
  unlocked: "Unlocked",
  unlockable: "Available",
  locked: "Locked",
  premium_locked: "PRO"
};

const stateLine = (node) => {
  const word = STATE_WORD[node.state] ?? "";
  if (node.premium && node.state !== "premium_locked") return `${word} · PRO`;
  return word;
};

const requirementRow = (requirement) => {
  const mark = requirement.met ? "\u2713" : "\u25CB";
  const current = formatNumber(requirement.current, requirement.current % 1 === 0 ? 0 : 1);
  const target = formatNumber(requirement.target, requirement.target % 1 === 0 ? 0 : 1);
  return `
    <li class="atlas-tip-req${requirement.met ? " is-met" : ""}">
      <span class="atlas-tip-mark" aria-hidden="true">${mark}</span>
      <span class="atlas-tip-req-label">${escapeHtml(requirement.label)}</span>
      <span class="atlas-tip-req-value">${current} / ${target}</span>
    </li>
  `;
};

export const tooltipHtml = (node) => {
  const requirements = (node.requirements ?? []).length
    ? `<ul class="atlas-tip-reqs">${node.requirements.map(requirementRow).join("")}</ul>`
    : "";
  const cost = node.cost > 0
    ? `<p class="atlas-tip-cost">Cost: <strong>${formatNumber(node.cost)} SP</strong></p>`
    : "";
  const reward = node.grant?.label
    ? `<p class="atlas-tip-reward">Reward: ${escapeHtml(node.grant.label)}</p>`
    : "";
  return `
    <p class="atlas-tip-name">${escapeHtml(node.name)}</p>
    <p class="atlas-tip-state is-${node.state}">${stateLine(node)}</p>
    ${requirements}
    ${cost}
    ${reward}
  `;
};
