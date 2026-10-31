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

const xpRows = (xp) => [
  ["Activity", xp.base ?? 0],
  ["Collectibles", xp.collectibles],
  ["Flowlines", xp.flowlines],
  ["Distance", xp.distance],
  ["Quests", xp.quests]
].filter(([, value]) => value > 0);

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

/** The authoritative "what changed" for one activity: XP breakdown, level, Skill Points, quests. */
export const ActivityOutcome = (outcome) => {
  if (!outcome) return "";
  const { progression, collectibles, flowlines, xp } = outcome;
  const breakdown = xpRows(xp);
  const levelLine = progression.levelsGained > 0
    ? `Level ${formatNumber(progression.previousLevel)} \u2192 ${formatNumber(progression.newLevel)}`
    : `Level ${formatNumber(progression.newLevel)}`;
  return `
    <section class="activity-outcome-card" aria-label="What changed" data-activity-outcome>
      <p class="activity-progress-label">WHAT CHANGED</p>
      <div class="activity-outcome-grid">
        <div>
          <strong class="activity-outcome-total">+${formatNumber(xp.total)} XP</strong>
          <ul class="activity-outcome-breakdown">
            ${breakdown.length
              ? breakdown.map(([label, value]) => `<li><span>${label}</span><b>+${formatNumber(value)}</b></li>`).join("")
              : "<li><span>No new XP</span><b>0</b></li>"}
          </ul>
        </div>
        <ul class="activity-outcome-facts">
          <li data-outcome-level><b>${levelLine}</b>${progression.levelsGained > 0 ? "<span>Level up!</span>" : ""}</li>
          <li data-outcome-collectibles><b>${formatNumber(collectibles.newCount)}</b> new collectible${collectibles.newCount === 1 ? "" : "s"}${collectibles.revisitCount > 0 ? ` <span>(${formatNumber(collectibles.revisitCount)} revisited, no XP)</span>` : ""}</li>
          ${flowlines.completedCount > 0 ? `<li data-outcome-flowlines><b>${formatNumber(flowlines.completedCount)}</b> Flowline${flowlines.completedCount === 1 ? "" : "s"} completed</li>` : ""}
          ${progression.skillPointsEarned > 0 ? `<li data-outcome-skill-points><b>+${formatNumber(progression.skillPointsEarned)}</b> Skill Point${progression.skillPointsEarned === 1 ? "" : "s"} earned</li>` : ""}
          ${progression.unspentSkillPoints > 0 ? `<li data-outcome-spend><b>${formatNumber(progression.unspentSkillPoints)}</b> Skill Point${progression.unspentSkillPoints === 1 ? "" : "s"} to spend <button type="button" class="outcome-link" data-outcome-open-atlas>Open Skill Atlas</button></li>` : ""}
        </ul>
      </div>
      ${outcome.unlockableNodes.length ? `<p class="activity-outcome-unlockable" data-outcome-unlockable>Now unlockable: ${outcome.unlockableNodes.map((node) => `<span data-user-content>${escapeHtml(node.name)}</span>`).join(", ")}</p>` : ""}
      ${outcome.quests.length ? `<ul class="activity-outcome-quests">${outcome.quests.map(QuestResult).join("")}</ul>` : ""}
    </section>
  `;
};
