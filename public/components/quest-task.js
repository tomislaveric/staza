import { getAppLocale } from "../app-locales.js";

const formatNumber = (value) => new Intl.NumberFormat(getAppLocale(), { maximumFractionDigits: 0 }).format(value);

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

export const difficultyLabel = (difficulty) => difficulty.charAt(0).toUpperCase() + difficulty.slice(1);

export const QuestPill = (text, variant, title) =>
  `<span class="quest-pill is-${variant}"${title ? ` title="${escapeHtml(title)}"` : ""}>${escapeHtml(text)}</span>`;

const criterionValue = (criterion) => `${formatNumber(criterion.current)}/${formatNumber(criterion.required)}${criterion.unit ? ` ${criterion.unit}` : ""}`;

export const failurePills = (quest) => quest.lastFailure
  ? QuestPill("Fell short", "danger") + (quest.lastFailure.criteria ?? [])
    .filter((criterion) => criterion.met === false)
    .map((criterion) => QuestPill(criterionValue(criterion), "danger", criterion.label))
    .join("")
  : "";

export const questStep = (quest) => Number.isFinite(quest.step) && Number.isFinite(quest.totalSteps)
  ? QuestPill(`Step ${formatNumber(quest.step)}/${formatNumber(quest.totalSteps)}`, "muted")
  : "";

const attributes = (dataAttrs = {}) => Object.entries(dataAttrs)
  .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
  .join("");

/**
 * One quest row: state stripe, title (+ NEW), one-line goal, optional extra content and pills.
 * With a `target` the whole row is a button (Home to-dos) that ends in a chevron.
 * `pills` and `extra` are trusted HTML built from QuestPill; everything else is escaped.
 */
export const TaskRow = ({ state = "active", isNew = false, className = "", title, goal, pills = "", extra = "", target, dataAttrs } = {}) => {
  const classes = ["quest-task", target ? "is-action" : "", className, `is-${state}`, isNew ? "is-new" : ""].filter(Boolean).join(" ");
  const inner = `
    <span class="quest-task-body">
      <span class="quest-task-head"><strong data-user-content>${escapeHtml(title)}</strong>${isNew ? QuestPill("NEW", "new") : ""}</span>
      ${goal ? `<span class="quest-task-goal" data-user-content title="${escapeHtml(goal)}">${escapeHtml(goal)}</span>` : ""}
      ${extra}
    </span>
    ${pills ? `<span class="quest-pills quest-task-meta">${pills}</span>` : ""}`;
  return target
    ? `<li class="quest-task-item"><button type="button" class="${classes}" data-home-action-target="${escapeHtml(target)}"${attributes(dataAttrs)}>${inner}
    <span class="quest-task-chevron" aria-hidden="true">›</span></button></li>`
    : `<li class="${classes}"${attributes(dataAttrs)}>${inner}
  </li>`;
};

export const AuthoredQuestTask = (quest, { target } = {}) => TaskRow({
  state: quest.state,
  isNew: quest.isNew,
  className: "authored-quest",
  title: quest.title,
  goal: quest.description,
  extra: quest.lastFailure ? `<span class="quest-pills">${failurePills(quest)}</span>` : "",
  pills: `${quest.state === "completed" ? QuestPill("Completed", "success") : ""}${QuestPill(difficultyLabel(quest.difficulty), "muted")}${questStep(quest)}${QuestPill(`+${formatNumber(quest.xp)} XP`, "accent")}`,
  target,
  dataAttrs: { "data-authored-quest": quest.id }
});
