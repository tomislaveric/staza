import { getAppLocale } from "../app-locales.js";
import { levelStateAt } from "./activity-outcome.js";

const formatNumber = (value) => new Intl.NumberFormat(getAppLocale(), {
  maximumFractionDigits: 0
}).format(value);

/**
 * With a frozen outcome the card shows the activity's own result (XP including quest bonuses,
 * level after this activity); older activities without one fall back to the current progress.
 */
export const ActivityProgress = (activity, progress) => {
  const outcome = activity.replay?.outcome;
  const state = outcome ? levelStateAt(outcome, outcome.xp.total) : progress;
  const earnedXp = outcome ? outcome.xp.total : activity.xpEarned;
  const collected = outcome ? outcome.collectibles.newCount : activity.collectedCount;
  const revisits = outcome ? outcome.collectibles.revisitCount : (activity.revisitCount ?? 0);
  const remaining = Math.max(0, state.nextLevelXp - state.currentLevelXp);
  const percent = Math.max(0, Math.min(100, state.progressToNextLevel * 100));
  return `
    <section class="activity-progress-card" aria-label="Activity progression">
      <div class="activity-progress-top">
        <div class="activity-progress-earned-group">
          <p class="activity-progress-label">XP EARNED</p>
          <div class="activity-progress-earned-row">
            <strong class="activity-progress-earned" data-activity-xp="${earnedXp}">+${formatNumber(earnedXp)}</strong>
            <div class="activity-replay-reward activity-replay-reward--desktop" data-replay-reward hidden aria-live="polite"></div>
          </div>
        </div>
        <div class="activity-progress-found"><p class="activity-progress-label">COLLECTED</p><strong>${formatNumber(collected)}</strong><span>${revisits > 0 ? `new · ${formatNumber(revisits)} revisited` : "new collectibles"}</span></div>
      </div>
      <div class="activity-progress-level">
        <div><span data-level-label>Level ${formatNumber(state.level)}</span></div>
        <p><strong data-level-xp>${formatNumber(state.currentLevelXp)}</strong> <em data-level-next>/ ${formatNumber(state.nextLevelXp)}</em></p>
      </div>
      <div class="activity-progress-track-wrap">
        <div class="activity-replay-reward activity-replay-reward--mobile" data-replay-reward hidden aria-live="polite"></div>
        <div class="activity-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="${state.nextLevelXp}" aria-valuenow="${state.currentLevelXp}">
          <span data-level-fill style="width: ${percent}%"></span>
        </div>
      </div>
      <p class="activity-progress-caption" data-level-caption>${formatNumber(remaining)} XP to Level ${formatNumber(state.level + 1)}</p>
    </section>
  `;
};
