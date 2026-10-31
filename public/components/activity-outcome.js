import { getAppLocale } from "../app-locales.js";
import { escapeHtml } from "./collected-list.js";

const formatNumber = (value) => new Intl.NumberFormat(getAppLocale(), { maximumFractionDigits: 0 }).format(value);

/**
 * Level state after `gainedXp` more XP than at import. Uses the level table frozen in the outcome,
 * so the replay can animate level-ups without asking the server.
 */
export const levelStateAt = (outcome, gainedXp = 0) => {
  const { previousTotalXp, levels } = outcome.progression;
  const total = previousTotalXp + Math.max(0, gainedXp);
  let index = 0;
  while (index + 1 < levels.length && levels[index + 1].totalXpRequired <= total) index += 1;
  const current = levels[index];
  const next = levels[index + 1];
  const nextLevelXp = next ? next.totalXpRequired - current.totalXpRequired : 1;
  const currentLevelXp = total - current.totalXpRequired;
  return {
    level: current.level,
    currentLevelXp,
    nextLevelXp,
    progressToNextLevel: Math.min(1, Math.max(0, currentLevelXp / nextLevelXp)),
    totalXp: total
  };
};

const criterionLine = (criterion) => {
  const unit = criterion.unit ? ` ${criterion.unit}` : "";
  const format = (value) => (criterion.unit || criterion.required > 1 ? formatNumber(value) : value);
  return `<li class="${criterion.met ? "is-met" : "is-missed"}"><span data-user-content>${escapeHtml(criterion.label)}</span><b>${format(criterion.current)} / ${format(criterion.required)}${unit}</b></li>`;
};

const QuestResult = (quest) => quest.result === "completed"
  ? `
    <li class="outcome-quest is-completed" data-outcome-quest="completed">
      <strong>Quest completed: <span data-user-content>${escapeHtml(quest.title)}</span></strong>
      <small data-user-content>${escapeHtml(quest.chainTitle ?? "Exploration")} · ${escapeHtml(quest.difficulty)} · +${formatNumber(quest.xp)} XP</small>
      ${quest.next ? `<small>Next: <span data-user-content>${escapeHtml(quest.next.title)}</span> (+${formatNumber(quest.next.xp)} XP)</small>` : ""}
    </li>`
  : `
    <li class="outcome-quest is-failed" data-outcome-quest="failed">
      <strong>Quest not completed: <span data-user-content>${escapeHtml(quest.title)}</span></strong>
      <small>This activity decided the attempt. You can retry from Quests.</small>
      <ul class="outcome-criteria">${quest.criteria.map(criterionLine).join("")}</ul>
    </li>`;

/** Quest results for one activity; the XP, level and Skill Point summary lives in the XP Earned card. */
export const ActivityOutcome = (outcome) => {
  if (!outcome?.quests.length) return "";
  return `
    <section class="activity-outcome-card" aria-label="Quest results" data-activity-outcome>
      <ul class="activity-outcome-quests">${outcome.quests.map(QuestResult).join("")}</ul>
    </section>
  `;
};
