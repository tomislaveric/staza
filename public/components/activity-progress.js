import { getAppLocale } from "../app-locales.js";
import { levelStateAt } from "./activity-outcome.js";

const formatNumber = (value) => new Intl.NumberFormat(getAppLocale(), {
  maximumFractionDigits: 0
}).format(value);

/**
 * With a frozen outcome the card shows the activity's own result (XP including quest bonuses,
 * level after this activity); older activities without one fall back to the current progress.
 */
const plural = (count, word) => `${formatNumber(count)} ${word}${count === 1 ? "" : "s"}`;

const SkillTreeCta = (progression) => {
  const earned = progression?.skillPointsEarned ?? 0;
  const unspent = progression?.unspentSkillPoints ?? 0;
  if (earned <= 0 && unspent <= 0) return "";
  const label = earned > 0 ? `+${plural(earned, "Skill Point")}` : `${plural(unspent, "Skill Point")} to spend`;
  return `<button type="button" class="activity-progress-cta" data-outcome-open-atlas${earned > 0 ? " data-skill-point-earned" : ""}><span>${label}</span><small>Open Skill Tree</small></button>`;
};

const factsLine = (collected, revisits, flowlinesCompleted) => [
  plural(collected, "new collectible"),
  revisits > 0 ? `${formatNumber(revisits)} revisited` : "",
  flowlinesCompleted > 0 ? plural(flowlinesCompleted, "Flowline") + " completed" : ""
].filter(Boolean).join(" \u00b7 ");

/**
 * One card for the activity's result: XP total, level progress, collection facts and the Skill Tree
 * call to action. Fixed-height rows keep the layout stable while the replay animates the numbers.
 * Older activities without a frozen outcome fall back to the current progress.
 */
export const ActivityProgress = (activity, progress) => {
  const outcome = activity.replay?.outcome;
  const state = outcome ? levelStateAt(outcome, outcome.xp.total) : progress;
  const earnedXp = outcome ? outcome.xp.total : activity.xpEarned;
  const collected = outcome ? outcome.collectibles.newCount : activity.collectedCount;
  const revisits = outcome ? outcome.collectibles.revisitCount : (activity.revisitCount ?? 0);
  const flowlines = outcome ? outcome.flowlines.completedCount : 0;
  const remaining = Math.max(0, state.nextLevelXp - state.currentLevelXp);
  const percent = Math.max(0, Math.min(100, state.progressToNextLevel * 100));
  const levelUp = outcome && outcome.progression.levelsGained > 0;
  const levelText = levelUp
    ? `Level ${formatNumber(outcome.progression.previousLevel)} \u2192 ${formatNumber(state.level)}`
    : `Level ${formatNumber(state.level)}`;
  const distanceXp = outcome?.xp.distance ?? 0;
  return `
    <section class="activity-progress-card" aria-label="Activity progression">
      <div class="activity-progress-top">
        <div class="activity-progress-earned-group">
          <p class="activity-progress-label">XP EARNED</p>
          <strong class="activity-progress-earned" data-activity-xp="${earnedXp}">+${formatNumber(earnedXp)}</strong>
        </div>
        ${outcome ? SkillTreeCta(outcome.progression) : ""}
      </div>
      <div class="activity-progress-level">
        <span data-level-label${levelUp ? ' class="is-level-up"' : ""}>${levelText}</span>
        <div class="activity-replay-reward" data-replay-reward hidden aria-live="polite"></div>
        <p><strong data-level-xp>${formatNumber(state.currentLevelXp)}</strong> <em data-level-next>/ ${formatNumber(state.nextLevelXp)}</em></p>
      </div>
      <div class="activity-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="${state.nextLevelXp}" aria-valuenow="${state.currentLevelXp}">
        <span data-level-fill style="width: ${percent}%"></span>
      </div>
      <div class="activity-progress-meta">
        <p class="activity-progress-caption" data-level-caption>${formatNumber(remaining)} XP to Level ${formatNumber(state.level + 1)}</p>
        <p class="activity-progress-caption activity-progress-distance" data-replay-distance>${distanceXp > 0 ? `Distance +${formatNumber(distanceXp)} XP` : ""}</p>
      </div>
      <p class="activity-progress-facts" data-outcome-collectibles>${factsLine(collected, revisits, flowlines)}</p>
    </section>
  `;
};
