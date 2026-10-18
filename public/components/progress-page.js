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

export const LevelStep = (level) => {
  if (level.state === "completed") {
    return `
      <li class="progress-level-step is-completed">
        <span class="progress-level-marker"><img src="/assets/progress-complete-check.svg" width="13" height="13" alt=""></span>
        <div class="progress-level-details">
          <div><strong>${escapeHtml(level.name)}</strong><em>COMPLETE</em><span>${formatNumber(level.totalXpRequired)} XP</span></div>
          <small>LEVEL ${formatNumber(level.level)}</small>
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

export const ProgressPage = (model) => `
  <section class="progress-page" aria-labelledby="progress-title">
    <header class="progress-header">
      <h1 id="progress-title">Progress</h1>
      <p>Your exploration journey</p>
    </header>
    ${ProgressSummary(model)}
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
    const dashboard = await fetch("/api/player/progress-dashboard").then(responseJson);
    mountPoint.innerHTML = ProgressPage(progressViewModel(dashboard));
  } catch (error) {
    mountPoint.innerHTML = `<section class="progress-page"><p class="progress-load-error" role="alert">Unable to load Progress: ${escapeHtml(error.message)}</p></section>`;
  }
};
