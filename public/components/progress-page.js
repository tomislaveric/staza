import { getAppLocale } from "../app-locales.js";

const levelNames = {
  5: "Adventurer",
  6: "Explorer",
  7: "Explorer",
  8: "Pathfinder",
  9: "Trailblazer",
  10: "Waymaker"
};

const formatNumber = (value, maximumFractionDigits = 0) => new Intl.NumberFormat(getAppLocale(), {
  maximumFractionDigits
}).format(value);

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

export const levelName = (level) => levelNames[level] ?? `Level ${formatNumber(level)}`;

export const formatActivityDate = (startedAt) => {
  const parts = new Intl.DateTimeFormat(getAppLocale(), {
    day: "2-digit",
    month: "short",
    weekday: "short",
    timeZone: "UTC"
  }).formatToParts(new Date(startedAt));
  const value = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("weekday")} ${value("day")} ${value("month")}`.toUpperCase();
};

export const progressViewModel = (dashboard) => {
  const { progress, lifetime, levels, recentActivities } = dashboard;
  const maximumActivityXp = Math.max(0, ...recentActivities.map((activity) => activity.xpEarned));
  return {
    ...dashboard,
    progress: {
      ...progress,
      percentage: Math.max(0, Math.min(100, progress.progressToNextLevel * 100)),
      remainingXp: Math.max(0, progress.nextLevelXp - progress.currentLevelXp)
    },
    levels: levels.map((item) => ({
      ...item,
      name: levelName(item.level),
      state: item.level < progress.level ? "completed" : item.level === progress.level ? "current" : "future"
    })),
    lifetime: { ...lifetime },
    recentActivities: recentActivities.map((activity) => ({
      ...activity,
      percentage: maximumActivityXp ? Math.max(0, Math.min(100, activity.xpEarned / maximumActivityXp * 100)) : 0
    }))
  };
};

export const ProgressSummary = ({ progress, lifetime }) => `
  <p class="progress-summary">
    <strong>${formatNumber(progress.totalXp)} XP</strong>
    <i aria-hidden="true">·</i>
    <span>${formatNumber(lifetime.distanceMeters / 1000, 1)} km covered</span>
    <i aria-hidden="true">·</i>
    <span>${formatNumber(lifetime.totalCollectibles)} collectibles</span>
  </p>
`;

const SkillPointAward = (level) => level.skillPointsAwarded > 0
  ? `<span class="progress-skill-point-award">+${formatNumber(level.skillPointsAwarded)} ${level.skillPointsAwarded === 1 ? "Skill Point" : "Skill Points"}</span>`
  : "";

export const LevelStep = (level) => {
  if (level.state === "completed") {
    return `
      <li class="progress-level-step is-completed">
        <span class="progress-level-marker"><img src="/assets/progress-complete-check.svg" width="13" height="13" alt=""></span>
        <div class="progress-level-details">
          <div><strong>${escapeHtml(level.name)}</strong><em>COMPLETE</em><span>${formatNumber(level.totalXpRequired)} XP</span></div>
          <small>LEVEL ${formatNumber(level.level)}</small>
          ${SkillPointAward(level)}
          <div class="progress-level-complete-bar" aria-hidden="true"><span></span></div>
        </div>
      </li>
    `;
  }
  return `
    <li class="progress-level-step is-future">
      <span class="progress-level-marker">${formatNumber(level.level)}</span>
      <div class="progress-level-details">
        <div><strong>${escapeHtml(level.name)}</strong><span>${formatNumber(level.totalXpRequired)} XP needed</span></div>
        <small>LEVEL ${formatNumber(level.level)}</small>
        ${SkillPointAward(level)}
      </div>
    </li>
  `;
};

export const CurrentLevel = (level, progress) => `
  <li class="progress-current-level">
    <span class="progress-level-marker">${formatNumber(level.level)}</span>
    <section class="progress-current-card" aria-label="Current level ${formatNumber(level.level)}">
      <div class="progress-current-title">
        <strong>${formatNumber(level.level)}</strong>
        <div><span>CURRENT</span><h2>${escapeHtml(level.name)}</h2></div>
      </div>
      ${SkillPointAward(level)}
      <div class="progress-current-track" role="progressbar" aria-valuemin="0" aria-valuemax="${progress.nextLevelXp}" aria-valuenow="${progress.currentLevelXp}">
        <span style="width: ${progress.percentage}%"></span>
      </div>
      <p><span>${formatNumber(progress.currentLevelXp)} XP</span><strong>${formatNumber(progress.remainingXp)} to Level ${formatNumber(progress.level + 1)}</strong></p>
    </section>
  </li>
`;

export const ProgressJourney = ({ levels, progress }) => `
  <ol class="progress-journey" aria-label="Level journey">
    ${levels.map((level) => level.state === "current" ? CurrentLevel(level, progress) : LevelStep(level)).join("")}
  </ol>
`;

export const RecentActivity = (activity) => {
  const distance = Number.isFinite(activity.distanceMeters)
    ? `${formatNumber(activity.distanceMeters / 1000, 1)} km`
    : "Distance unavailable";
  return `
    <li class="recent-activity">
      <div>
        <strong>Activity · ${escapeHtml(formatActivityDate(activity.startedAt))}</strong>
        <span>${escapeHtml(formatActivityDate(activity.startedAt))} · ${escapeHtml(distance)} · ${formatNumber(activity.collectedCount)} found</span>
      </div>
      <div class="recent-activity-xp">
        <span aria-hidden="true"><i style="width: ${activity.percentage}%"></i></span>
        <strong>+${formatNumber(activity.xpEarned)}</strong>
      </div>
    </li>
  `;
};

export const RecentActivities = (activities) => `
  <section class="recent-activities" aria-labelledby="recent-activities-title">
    <h2 id="recent-activities-title">RECENT ACTIVITIES</h2>
    ${activities.length
    ? `<ol>${activities.map(RecentActivity).join("")}</ol>`
    : '<p class="recent-activities-empty">NO COMPLETED ACTIVITIES YET</p>'}
  </section>
`;

const questRequirement = (quest) => quest.requiredNode
  ? `Unlock ${quest.requiredNode.name} in the Skill Tree${quest.requiredNode.premium ? " (PRO)" : ""}`
  : `Complete ${quest.requiredQuestTitle} first`;

const AuthoredQuest = (quest) => `
  <li class="authored-quest is-${quest.state}" data-authored-quest="${escapeHtml(quest.id)}">
    <div>
      <strong>${escapeHtml(quest.title)}</strong>
      <span>${escapeHtml(quest.description)}</span>
      ${quest.state === "locked" ? `<small class="authored-quest-lock">${escapeHtml(questRequirement(quest))}</small>` : ""}
    </div>
    <em>${quest.state === "completed" ? "Done" : `+${formatNumber(quest.xp)} XP`}</em>
  </li>
`;

export const AuthoredQuests = (quests = []) => {
  const available = quests.filter((quest) => quest.state === "available");
  const locked = quests.filter((quest) => quest.state === "locked");
  const completed = quests.filter((quest) => quest.state === "completed");
  return `
  <section class="authored-quests" aria-labelledby="authored-quests-title">
    <h2 id="authored-quests-title">QUESTS</h2>
    ${available.length
    ? `<ol>${available.map(AuthoredQuest).join("")}</ol>`
    : '<p class="authored-quests-empty">Unlock quest nodes in the Skill Tree to start quest chains.</p>'}
    ${completed.length ? `<p class="authored-quests-done">${formatNumber(completed.length)} completed</p>` : ""}
    ${locked.length ? `<details class="authored-quests-locked"><summary>Locked quests (${formatNumber(locked.length)})</summary><ol>${locked.map(AuthoredQuest).join("")}</ol></details>` : ""}
  </section>
`;
};

export const ProgressPage = (model) => `
  <section class="progress-page" aria-labelledby="progress-title">
    <header class="progress-header">
      <h1 id="progress-title">Progress</h1>
      <p>Your exploration journey</p>
    </header>
    ${ProgressSummary(model)}
    <p class="progress-skill-point-note">Reach certain levels to earn Skill Points you can spend in the Skill Tree.</p>
    ${AuthoredQuests(model.authoredQuests)}
    ${ProgressJourney(model)}
    ${RecentActivities(model.recentActivities)}
  </section>
`;

const responseJson = async (response) => {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Unable to load Progress data.");
  return body;
};

export const mountProgressPage = async (mountPoint) => {
  mountPoint.innerHTML = '<section class="progress-page"><p class="progress-loading" role="status">Loading Progress...</p></section>';
  try {
    const [dashboard, authored] = await Promise.all([
      fetch("/api/player/progress-dashboard").then(responseJson),
      fetch("/api/authored-quests").then(responseJson).catch(() => ({ quests: [] }))
    ]);
    mountPoint.innerHTML = ProgressPage({ ...progressViewModel(dashboard), authoredQuests: authored.quests });
  } catch (error) {
    mountPoint.innerHTML = `<section class="progress-page"><p class="progress-load-error" role="alert">Unable to load Progress: ${escapeHtml(error.message)}</p></section>`;
  }
};
