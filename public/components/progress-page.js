import { getAppLocale } from "../app-locales.js";

import { getActivityLabel } from "./activity-labels.js";

const formatNumber = (value, maximumFractionDigits = 0) => new Intl.NumberFormat(getAppLocale(), {
  maximumFractionDigits
}).format(value);

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

export const levelName = (level) => `Level ${formatNumber(level)}`;

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
  const { progress, lifetime, recentActivities } = dashboard;
  return {
    ...dashboard,
    progress: { ...progress, percentage: progress.progressPercent },
    lifetime: { ...lifetime },
    sportRecords: dashboard.sportRecords ?? [],
    milestones: dashboard.milestones ?? { places: 0, peaks: 0, mountainPasses: 0, flowlines: lifetime.totalFlowlines ?? 0 },
    recentActivities: recentActivities.map((activity) => ({ ...activity, percentage: activity.xpPercentOfBest }))
  };
};

export const ProgressSummary = ({ progress, lifetime }) => `
  <p class="progress-summary">
    <strong>${formatNumber(progress.totalXp)} XP</strong>
    <i aria-hidden="true">·</i>
    <span>${formatNumber(lifetime.distanceMeters / 1000, 1)} km covered</span>
    <i aria-hidden="true">·</i>
    <span>${formatNumber(lifetime.totalCollectibles)} collectibles</span>
    <i aria-hidden="true">·</i>
    <span>${formatNumber(lifetime.totalFlowlines ?? 0)} Flowlines</span>
  </p>
`;

/** The player's level once, with progress to the next one. */
export const LevelCard = (progress) => `
  <section class="progress-level-card" aria-label="Level progress">
    <div class="progress-level-card-head">
      <h2>${escapeHtml(levelName(progress.level))}</h2>
    </div>
    <div class="progress-current-track" role="progressbar" aria-valuemin="0" aria-valuemax="${progress.nextLevelXp}" aria-valuenow="${progress.currentLevelXp}">
      <span style="width: ${progress.percentage}%"></span>
    </div>
    <p class="progress-level-card-caption">${formatNumber(progress.currentLevelXp)} XP · ${formatNumber(progress.remainingXp)} to Level ${formatNumber(progress.level + 1)}</p>
  </section>
`;

const sportLabels = { cycling: "Cycling", running: "Running", hiking: "Hiking" };

const kmLabel = (meters) => `${formatNumber(meters / 1000, 1)} km`;

/** Badges and titles earned from unlocked Skill Atlas nodes. */
export const Trophies = (capabilities) => {
  const badges = capabilities?.badges ?? [];
  const titles = capabilities?.titles ?? [];
  return `
  <section class="progress-trophies" aria-labelledby="progress-trophies-title">
    <h2 id="progress-trophies-title">BADGES &amp; TITLES</h2>
    ${badges.length || titles.length ? `<ul class="progress-trophy-list">
      ${badges.map((badge) => `<li class="progress-trophy is-badge"><small>Badge</small><strong>${escapeHtml(badge.label)}</strong></li>`).join("")}
      ${titles.map((title) => `<li class="progress-trophy is-title"><small>Title</small><strong>${escapeHtml(title.label)}</strong></li>`).join("")}
    </ul>` : '<p class="progress-empty">NO BADGES OR TITLES YET</p>'}
  </section>
`;
};

/** Per-sport lifetime distance and personal bests. */
export const PersonalRecords = (sportRecords = []) => `
  <section class="progress-records" aria-labelledby="progress-records-title">
    <h2 id="progress-records-title">PERSONAL RECORDS</h2>
    ${sportRecords.length ? `<ul class="progress-record-list">
      ${sportRecords.map((record) => `
        <li class="progress-record" data-sport-record="${escapeHtml(record.type)}">
          <strong>${escapeHtml(sportLabels[record.type] ?? record.type)}</strong>
          <dl>
            <div><dt>Total distance</dt><dd>${escapeHtml(kmLabel(record.distanceMeters))}</dd></div>
            <div><dt>Longest</dt><dd>${escapeHtml(kmLabel(record.longestDistanceMeters))}</dd></div>
            ${Number.isFinite(record.highestElevationGainM)
    ? `<div><dt>Highest elevation gain</dt><dd>${formatNumber(record.highestElevationGainM)} m</dd></div>` : ""}
          </dl>
        </li>`).join("")}
    </ul>` : '<p class="progress-empty">IMPORT AN ACTIVITY TO SET YOUR FIRST RECORD</p>'}
  </section>
`;

export const DiscoveryMilestones = (milestones) => `
  <section class="progress-milestones" aria-labelledby="progress-milestones-title">
    <h2 id="progress-milestones-title">DISCOVERIES</h2>
    <dl class="progress-milestone-list">
      <div><dt>Flowlines</dt><dd>${formatNumber(milestones.flowlines)}</dd></div>
      <div><dt>Places</dt><dd>${formatNumber(milestones.places)}</dd></div>
      <div><dt>Peaks</dt><dd>${formatNumber(milestones.peaks)}</dd></div>
      <div><dt>Mountain passes</dt><dd>${formatNumber(milestones.mountainPasses)}</dd></div>
    </dl>
  </section>
`;

export const activityFacts = (activity) => [
  formatActivityDate(activity.startedAt),
  Number.isFinite(activity.distanceMeters) ? `${formatNumber(activity.distanceMeters / 1000, 1)} km` : "Distance unavailable",
  `${formatNumber(activity.collectedCount)} collected`,
  ...(activity.revisitCount > 0 ? [`${formatNumber(activity.revisitCount)} revisited`] : []),
  ...(activity.flowlineCount > 0 ? [`${formatNumber(activity.flowlineCount)} ${activity.flowlineCount === 1 ? "Flowline" : "Flowlines"}`] : [])
].join(" · ");

export const activityTitle = (activity) => activity.title || `${getActivityLabel(activity.type)} · ${formatActivityDate(activity.startedAt)}`;

export const RecentActivity = (activity) => `
  <li class="recent-activity">
    <div>
      <strong data-user-content>${escapeHtml(activityTitle(activity))}</strong>
      <span>${escapeHtml(activityFacts(activity))}</span>
    </div>
    <div class="recent-activity-xp">
      <span aria-hidden="true"><i style="width: ${activity.percentage}%"></i></span>
      <strong>+${formatNumber(activity.xpEarned)}</strong>
    </div>
  </li>
`;

export const RecentActivities = (activities) => `
  <section class="recent-activities" aria-labelledby="recent-activities-title">
    <h2 id="recent-activities-title">RECENT ACTIVITIES</h2>
    ${activities.length
    ? `<ol>${activities.map(RecentActivity).join("")}</ol>`
    : '<p class="recent-activities-empty">NO COMPLETED ACTIVITIES YET</p>'}
  </section>
`;

const questRequirement = (quest) => quest.requiredNode
  ? `Unlock ${quest.requiredNode.name} in the Skill Atlas${quest.requiredNode.premium ? " (PRO)" : ""}`
  : `Complete ${quest.requiredQuestTitle} first`;

const difficultyLabel = (difficulty) => difficulty.charAt(0).toUpperCase() + difficulty.slice(1);

const criteriaList = (criteria = []) => criteria.length
  ? `<ul class="authored-quest-criteria">${criteria.map((criterion) => `<li class="${criterion.met ? "is-met" : "is-missed"}"><span data-user-content>${escapeHtml(criterion.label)}</span> <b>${formatNumber(criterion.current)} / ${formatNumber(criterion.required)}${criterion.unit ? ` ${escapeHtml(criterion.unit)}` : ""}</b></li>`).join("")}</ul>`
  : "";

const questStatus = (quest) => {
  if (quest.state === "completed") return "Done";
  if (quest.state === "active") return "Active · your next activity decides";
  return "";
};

const failureHint = (quest) => quest.lastFailure
  ? `<small class="authored-quest-failure">Last activity fell short · try again</small>${criteriaList(quest.lastFailure.criteria)}`
  : "";

const AuthoredQuest = (quest) => `
  <li class="quest-instance-card authored-quest is-${quest.state}${quest.isNew ? " is-new" : ""}" data-authored-quest="${escapeHtml(quest.id)}">
    <article>
      <span class="quest-card-head"><strong data-user-content>${escapeHtml(quest.title)}</strong>${quest.isNew ? '<i class="new-reward-tag">NEW</i>' : ""}</span>
      <span class="quest-card-description" data-user-content>${escapeHtml(quest.description)}</span>
      <span class="quest-card-progress">
        <small class="authored-quest-meta"><span>${escapeHtml(difficultyLabel(quest.difficulty))}</span> · +${formatNumber(quest.xp)} XP${questStatus(quest) ? ` · <span>${questStatus(quest)}</span>` : ""}</small>
        ${quest.state === "active" ? failureHint(quest) : ""}
        ${quest.state === "locked" ? `<small class="authored-quest-lock">${escapeHtml(questRequirement(quest))}</small>` : ""}
      </span>
    </article>
  </li>
`;

export const AuthoredQuests = (quests = []) => {
  const open = quests.filter((quest) => quest.state === "active");
  const locked = quests.filter((quest) => quest.state === "locked");
  const completed = quests.filter((quest) => quest.state === "completed");
  const justCompleted = completed.filter((quest) => quest.isNew);
  return `
  <section class="authored-quests" aria-labelledby="authored-quests-title">
    <h2 id="authored-quests-title">QUESTS</h2>
    <p class="authored-quests-rule">Unlocked quests are active right away. Your next activity decides them. Quests pay bonus XP by difficulty.</p>
    ${justCompleted.length ? `<ol class="home-quest-list authored-quests-just-completed">${justCompleted.map(AuthoredQuest).join("")}</ol>` : ""}
    ${open.length
    ? `<ol class="home-quest-list">${open.map(AuthoredQuest).join("")}</ol>`
    : ""}
    ${completed.length ? `<p class="authored-quests-done">${formatNumber(completed.length)} completed</p>` : ""}
    ${locked.length ? `<details class="authored-quests-locked"><summary>Locked quests (${formatNumber(locked.length)})</summary><ol class="home-quest-list">${locked.map(AuthoredQuest).join("")}</ol></details>` : ""}
  </section>
`;
};

export const QuestBadges = (quests = []) => {
  const finished = quests.filter((quest) => quest.state === "completed");
  return finished.length ? `
  <section class="quest-badges-section" aria-labelledby="quest-badges-title">
    <h2 id="quest-badges-title">FINISHED QUESTS</h2>
    <ul class="quest-badges">${finished.map((quest) => `<li class="quest-badge${quest.isNew ? " is-new" : ""}" data-quest-badge="${escapeHtml(quest.id)}">
      <b data-user-content>${escapeHtml(quest.title)}</b>
      <small data-user-content>${escapeHtml(quest.description)}</small>
    </li>`).join("")}</ul>
  </section>
` : "";
};

export const QuestHistory = (history = []) => history.length ? `
  <section class="quest-history" aria-labelledby="quest-history-title">
    <h2 id="quest-history-title">COMPLETED QUESTS</h2>
    <ol>
      ${history.map((entry) => `
        <li class="quest-history-entry" data-quest-history="${escapeHtml(entry.id)}">
          <div>
            <strong data-user-content>${escapeHtml(entry.title)}</strong>
            <span data-user-content>${escapeHtml(entry.chainTitle ?? (entry.kind === "exploration" ? "Exploration" : "Quest"))} · ${escapeHtml(difficultyLabel(entry.difficulty))} · ${escapeHtml(formatActivityDate(entry.completedAt))}</span>
          </div>
          <em>+${formatNumber(entry.xp)} XP</em>
        </li>`).join("")}
    </ol>
  </section>
` : "";

export const ProgressPage = (model) => `
  <section class="progress-page" aria-labelledby="progress-title">
    <header class="progress-header">
      <h1 id="progress-title">Progress</h1>
      <p>What you have accomplished</p>
    </header>
    ${LevelCard(model.progress)}
    ${AuthoredQuests(model.authoredQuests)}
    ${QuestBadges(model.authoredQuests)}
    ${ProgressSummary(model)}
    ${Trophies(model.capabilities)}
    ${PersonalRecords(model.sportRecords)}
    ${DiscoveryMilestones(model.milestones)}
    ${QuestHistory(model.questHistory)}
    ${RecentActivities(model.recentActivities)}
  </section>
`;

export const responseJson = async (response) => {
  if (response.status === 204) return undefined;
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Unable to load Progress data.");
  return body;
};

export const mountProgressPage = async (mountPoint, { onRewardsSeen } = {}) => {
  mountPoint.innerHTML = '<section class="progress-page"><p class="progress-loading" role="status">Loading Progress...</p></section>';
  try {
    const [dashboard, authored, capabilities] = await Promise.all([
      fetch("/api/player/progress-dashboard").then(responseJson),
      fetch("/api/authored-quests").then(responseJson).catch(() => ({ quests: [] })),
      fetch("/api/player/capabilities").then(responseJson).catch(() => ({}))
    ]);
    mountPoint.innerHTML = ProgressPage({ ...progressViewModel(dashboard), capabilities, authoredQuests: authored.quests });
    // Opening Progress is what clears the "new" highlights; this render still shows them.
    fetch("/api/rewards/seen", { method: "POST" }).then(() => onRewardsSeen?.()).catch(() => undefined);
  } catch (error) {
    mountPoint.innerHTML = `<section class="progress-page"><p class="progress-load-error" role="alert">Unable to load Progress: ${escapeHtml(error.message)}</p></section>`;
  }
};
