import { getAppLocale } from "../app-locales.js";
import { getActivityLabel } from "./activity-labels.js";

const formatNumber = (value, maximumFractionDigits = 0) => new Intl.NumberFormat(getAppLocale(), {
  maximumFractionDigits
}).format(value);

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

const durationLabel = (seconds) => {
  if (!Number.isFinite(seconds)) return undefined;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};

const dateLabel = (startedAt) => new Intl.DateTimeFormat(getAppLocale(), {
  day: "2-digit", month: "short", weekday: "short"
}).format(new Date(startedAt)).toUpperCase();

const replayForHome = (activity) => {
  const replay = activity?.replay;
  if (
    !Array.isArray(replay?.activity?.route)
    || replay.activity.route.length < 2
    || !Array.isArray(replay.activityResult?.collectibles)
    || !Array.isArray(replay.activityResult?.events)
  ) return undefined;
  return replay;
};

export const homeViewModel = (progress, activities, lifetime) => {
  const latest = activities[0];
  const totalDistanceMeters = activities.reduce((total, activity) => total + (activity.distanceMeters ?? 0), 0);
  return {
    progress: {
      ...progress,
      remainingXp: Math.max(0, progress.nextLevelXp - progress.currentLevelXp)
    },
    stats: {
      totalXp: progress.totalXp,
      distanceMeters: lifetime?.distanceMeters ?? totalDistanceMeters,
      totalCollected: lifetime?.totalCollectibles ?? activities.reduce((total, activity) => total + activity.collectedCount, 0),
      totalFlowlines: lifetime?.totalFlowlines ?? activities.reduce((total, activity) => total + (activity.flowlineCount ?? 0), 0)
    },
    latest
  };
};

export const HomePlayerProgress = ({ progress, stats }) => `
  <section class="home-hero" aria-label="Player progress">
    <div class="home-progress">
      <strong class="home-level">${formatNumber(progress.level)}</strong>
      <div class="home-progress-details">
        <p class="home-section-label">LEVEL ${formatNumber(progress.level)}</p>
        <p class="home-xp"><strong>${formatNumber(progress.currentLevelXp)}</strong> <span>/ ${formatNumber(progress.nextLevelXp)} XP</span></p>
        <div class="home-xp-track" role="progressbar" aria-valuemin="0" aria-valuemax="${progress.nextLevelXp}" aria-valuenow="${progress.currentLevelXp}">
          <span style="width: ${Math.min(100, Math.max(0, progress.progressToNextLevel * 100))}%"></span>
        </div>
        <p class="home-progress-caption">${formatNumber(progress.remainingXp)} XP to Level ${formatNumber(progress.level + 1)}</p>
      </div>
    </div>
  </section>
`;

const foundItems = (events) => events.slice(0, 4).map((event) =>
  `<li class="home-found-item" data-user-content>${escapeHtml(event.collectible?.name ?? event.sourceId)}</li>`
).join("");

export const HomeRecentActivity = (activity) => {
  if (!activity) {
    return `
      <section class="home-recent-activity" aria-labelledby="recent-activity-title">
        <div class="home-section-heading"><h1 id="recent-activity-title">RECENT ACTIVITY</h1></div>
        <div class="home-empty-state">
          <p class="home-section-label">NO COMPLETED ACTIVITIES YET</p>
          <p>Complete a FIT activity to see your latest activity, collectibles, and XP here.</p>
        </div>
      </section>
    `;
  }
  const details = [
    getActivityLabel(activity.type),
    activity.durationSeconds === undefined ? undefined : durationLabel(activity.durationSeconds),
    `${activity.collectedCount} collected`,
    activity.revisitCount > 0 ? `${activity.revisitCount} revisited` : undefined,
    activity.flowlineCount > 0 ? `${activity.flowlineCount} ${activity.flowlineCount === 1 ? "Flowline" : "Flowlines"}` : undefined,
    activity.hasVideo ? "POV available" : undefined
  ].filter(Boolean);
  const replay = replayForHome(activity);
  return `
    <section class="home-recent-activity" aria-labelledby="recent-activity-title">
      <div class="home-section-heading"><h1 id="recent-activity-title">RECENT ACTIVITY</h1></div>
      <button class="home-activity-card" type="button" data-activity-id="${escapeHtml(activity.id)}" aria-label="View recent activity">
        <header class="home-activity-header">
          <div>
            <p class="home-section-label">${dateLabel(activity.startedAt)}</p>
            ${activity.title ? `<p class="home-activity-title" data-user-content>${escapeHtml(activity.title)}</p>` : ""}
            <p class="home-distance">${activity.distanceMeters === undefined ? "—" : formatNumber(activity.distanceMeters / 1000, 1)} <span>KM</span></p>
          </div>
          <div class="home-earned"><span>XP EARNED</span><strong>+${formatNumber(activity.xpEarned)}</strong></div>
        </header>
        ${replay ? ReplayStill({ canvasLabel: "Recent activity route", className: "home-activity-replay" }) : ""}
        <div class="home-activity-details">${details.map((detail) => `<span>${escapeHtml(detail)}</span>`).join("<i aria-hidden=\"true\">·</i>")}</div>
        ${activity.events?.length ? `<div class="home-found"><span>COLLECTED</span><ul>${foundItems(activity.events)}</ul></div>` : '<p class="home-no-finds">No collectibles were recorded on this activity.</p>'}
      </button>
    </section>
  `;
};

export const activeQuestInstances = (instances) => (instances ?? []).filter((instance) => instance.status === "active");

/** Active attempts plus failed ones the player can retry. */
export const openQuestInstances = (instances) => (instances ?? []).filter((instance) => instance.status === "active" || instance.status === "failed");

export const HomeActiveQuestCard = (instance) => {
  const objectives = instance.objectives ?? [];
  const completed = objectives.filter((item) => item.progress.complete).length;
  const ratio = objectives.length ? completed / objectives.length : 0;
  const failed = instance.status === "failed";
  return `
    <li class="quest-instance-card is-${escapeHtml(instance.status)}">
      <article>
        <span class="quest-card-head"><strong data-user-content>${escapeHtml(instance.title)}</strong><small>Exploration</small></span>
        <span class="quest-card-description" data-user-content>${escapeHtml(instance.description)}</span>
        <span class="quest-card-progress">
          <span class="quest-progress-track" aria-hidden="true"><i style="width: ${Math.round(ratio * 100)}%;"></i></span>
          <small>${failed ? `Not completed · ${completed} / ${objectives.length} objectives` : `${completed} / ${objectives.length} objectives · your next activity decides`}</small>
        </span>
        ${failed ? `<button type="button" class="home-retry-exploration" data-retry-instance="${escapeHtml(instance.id)}">Retry</button>` : ""}
      </article>
    </li>
  `;
};

export const HomeActiveQuests = (instances = [], authoredAttempts = []) => `
  <section class="home-active-quests" aria-labelledby="active-quests-title">
    <div class="home-section-heading"><h1 id="active-quests-title">QUESTS &amp; EXPLORATIONS</h1></div>
    ${authoredAttempts.length || instances.length
      ? `<ol class="home-quest-list">${authoredAttempts.map(HomeAuthoredAttemptCard).join("")}${instances.map(HomeActiveQuestCard).join("")}</ol>`
      : `<div class="home-empty-state"><p>Nothing in progress. Start a quest on <button type="button" class="home-find-quests" data-home-progress>Progress</button> or plan an exploration in <button type="button" class="home-find-quests" data-home-find-quests>World</button>.</p></div>`}
  </section>
`;

const HomeAuthoredAttemptCard = (quest) => `
  <li class="quest-instance-card is-${escapeHtml(quest.state)}">
    <article>
      <span class="quest-card-head"><strong data-user-content>${escapeHtml(quest.title)}</strong><small>Quest</small></span>
      <span class="quest-card-description" data-user-content>${escapeHtml(quest.description)}</span>
      <span class="quest-card-progress"><small>${quest.state === "failed" ? "Not completed · retry on Progress" : "Active · your next activity decides"} · +${formatNumber(quest.xp)} XP</small></span>
    </article>
  </li>
`;

/**
 * One recommended next step. Priority: spend Skill Points, resolve a failed attempt, wait on an
 * active one, start the next quest, otherwise plan an exploration.
 */
export const homeNextAction = ({ skillPoints = 0, authoredQuests = [], instances = [] } = {}) => {
  if (skillPoints > 0) {
    return { id: "spend-skill-points", title: `Spend ${skillPoints} Skill Point${skillPoints === 1 ? "" : "s"}`, body: "Unlock new sports, filters and quest chains in the Skill Atlas.", cta: "Open Skill Atlas", target: "skill-tree" };
  }
  const failed = authoredQuests.find((quest) => quest.state === "failed");
  if (failed) return { id: "retry-quest", title: `Retry ${failed.title}`, body: "Your last attempt didn't meet every criterion. Start it again and your next activity decides.", cta: "Open Quests", target: "progress" };
  const active = authoredQuests.find((quest) => quest.state === "active") ?? instances.find((instance) => instance.status === "active");
  if (active) return { id: "active-quest", title: `${active.title} is active`, body: "Go for your next ride, run or hike. That activity decides the attempt.", cta: "View Quests", target: "progress" };
  const available = authoredQuests.find((quest) => quest.state === "available");
  if (available) return { id: "start-quest", title: `Start ${available.title}`, body: `${available.chainTitle ?? "Quest"} · +${formatNumber(available.xp)} XP when your next activity completes it.`, cta: "Open Quests", target: "progress" };
  return { id: "plan-exploration", title: "Plan an exploration", body: "Pick an area in World and turn it into a route with targets to collect.", cta: "Open World", target: "world" };
};

export const HomeNextAction = (action) => `
  <section class="home-next-action" aria-labelledby="next-action-title" data-home-next-action="${escapeHtml(action.id)}">
    <small>NEXT</small>
    <h2 id="next-action-title">${escapeHtml(action.title)}</h2>
    <p>${escapeHtml(action.body)}</p>
    <button type="button" class="home-next-action-cta" data-home-action-target="${escapeHtml(action.target)}">${escapeHtml(action.cta)}</button>
  </section>
`;

export const HomeOnboarding = () => `
  <section class="home-onboarding" aria-labelledby="onboarding-title" data-home-onboarding>
    <small>WELCOME TO STAZA</small>
    <h2 id="onboarding-title">Turn real rides, runs and hikes into a game</h2>
    <p>Staza finds the places you pass on real routes. Collect them for XP, level up, spend Skill Points in the Skill Atlas and complete quests.</p>
    <ol>
      <li>Add an activity from a FIT file or Strava.</li>
      <li>Watch the replay and see what changed.</li>
      <li>Pick a quest or plan an exploration for your next outing.</li>
    </ol>
    <button type="button" class="home-next-action-cta" data-home-action-target="add-activity">Add your first activity</button>
  </section>
`;

const pct = (value, total) => (total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0);

export const HomeAchievements = ({ skillPoints = 0, unlocked = [], totalNodes = 0, titles = [], badges = [], nextQuest, stats } = {}) => {
  const earned = [...titles, ...badges];
  return `
  <section class="home-achievements" aria-labelledby="achievements-title">
    <div class="home-section-heading"><h1 id="achievements-title">SKILLS &amp; ACHIEVEMENTS</h1></div>
    <div class="home-tiles">
      <button type="button" class="home-tile" data-home-skill-tree>
        <small>SKILLS</small>
        <strong data-home-unlocked-count>${unlocked.length}<em> / ${totalNodes}</em></strong>
        <span class="quest-progress-track" aria-hidden="true"><i style="width: ${pct(unlocked.length, totalNodes)}%;"></i></span>
        ${skillPoints > 0 ? `<b class="home-tile-flag" data-home-skill-points>${formatNumber(skillPoints)} SP to spend</b>` : ""}
      </button>
      <div class="home-tile" data-home-achievements>
        <small>ACHIEVEMENTS</small>
        <strong>${earned.length}</strong>
        <span data-user-content>${earned.length ? escapeHtml(earned.slice(0, 2).map((item) => item.label).join(" · ")) : "Titles and badges you earn"}</span>
      </div>
      ${stats ? `<dl class="home-tile home-summary" data-home-summary>
        <small>SUMMARY</small>
        <div><dt>Total XP</dt><dd>${formatNumber(stats.totalXp)}</dd></div>
        <div><dt>Distance</dt><dd>${formatNumber(stats.distanceMeters / 1000, 1)} km</dd></div>
        <div><dt>Collected</dt><dd>${formatNumber(stats.totalCollected)}</dd></div>
        <div><dt>Flowlines</dt><dd>${formatNumber(stats.totalFlowlines ?? 0)}</dd></div>
      </dl>` : ""}
    </div>
    ${nextQuest ? `<button type="button" class="home-next-quest" data-home-next-quest>
      <span class="home-next-quest-head"><small>NEXT QUEST · ${escapeHtml(nextQuest.chainTitle).toUpperCase()}</small><b>+${formatNumber(nextQuest.xp)} XP</b></span>
      <strong data-user-content>${escapeHtml(nextQuest.title)}</strong>
      <span class="home-next-quest-desc" data-user-content>${escapeHtml(nextQuest.description)}</span>
      <span class="home-next-quest-foot">
        <span class="quest-progress-track" aria-hidden="true"><i style="width: ${pct(nextQuest.step - 1, nextQuest.totalSteps)}%;"></i></span>
        <small>Step ${nextQuest.step} of ${nextQuest.totalSteps}</small>
      </span>
    </button>` : ""}
  </section>
`;
};

export const HomePage = (model) => `
  <section class="home-page">
    ${HomePlayerProgress(model)}
    ${model.latest ? HomeNextAction(homeNextAction({ skillPoints: model.achievements?.skillPoints, authoredQuests: model.achievements?.authoredQuests, instances: model.activeQuests })) : HomeOnboarding()}
    ${HomeAchievements({ ...model.achievements, stats: model.stats })}
    ${HomeRecentActivity(model.latest)}
    ${HomeActiveQuests(model.activeQuests, (model.achievements?.authoredQuests ?? []).filter((quest) => quest.state === "active" || quest.state === "failed"))}
  </section>
`;

const responseJson = async (response) => {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Unable to load Home data.");
  return body;
};

// Achievements are secondary; Home must still render if they cannot load.
const loadAchievements = async () => {
  try {
    const [tree, capabilities, quests] = await Promise.all([
      fetch("/api/skill-tree").then(responseJson),
      fetch("/api/player/capabilities").then(responseJson),
      fetch("/api/authored-quests").then(responseJson).catch(() => ({ quests: [] }))
    ]);
    return {
      skillPoints: tree.balance,
      unlocked: tree.nodes.filter((node) => node.state === "unlocked"),
      totalNodes: tree.nodes.length,
      titles: capabilities.titles,
      badges: capabilities.badges,
      nextQuest: quests.quests.find((quest) => quest.state === "available"),
      authoredQuests: quests.quests
    };
  } catch {
    return undefined;
  }
};

export const mountHomePage = async (mountPoint, onSelectActivity, onNavigate) => {
  mountPoint.innerHTML = '<section class="home-page"><p class="home-loading" role="status">Loading Home...</p></section>';
  try {
    const [dashboard, history, questBody, achievements] = await Promise.all([
      fetch("/api/player/progress-dashboard").then(responseJson),
      fetch("/api/activities").then(responseJson),
      fetch("/api/quest-instances").then(responseJson),
      loadAchievements()
    ]);
    const latestSummary = history[0];
    const latest = latestSummary
      ? { ...latestSummary, ...(await fetch(`/api/activities/${encodeURIComponent(latestSummary.id)}`).then(responseJson)) }
      : undefined;
    const model = {
      ...homeViewModel(dashboard.progress, latest ? [latest, ...history.slice(1)] : [], dashboard.lifetime),
      activeQuests: openQuestInstances(questBody.instances),
      achievements
    };
    mountPoint.innerHTML = HomePage(model);
    const replay = replayForHome(model.latest);
    if (replay) {
      const basemap = await fetch("/api/world/basemap").then(responseJson).catch(() => undefined);
      mountReplayStillCard(mountPoint.querySelector(".home-activity-card"), replay, basemap);
    }
    mountPoint.querySelector("[data-home-skill-tree]")?.addEventListener("click", () => onNavigate?.("skill-tree"));
    mountPoint.querySelector("[data-home-next-quest]")?.addEventListener("click", () => onNavigate?.("progress"));
    mountPoint.querySelector("[data-home-find-quests]")?.addEventListener("click", () => onNavigate?.("world"));
    mountPoint.querySelector("[data-home-progress]")?.addEventListener("click", () => onNavigate?.("progress"));
    mountPoint.querySelectorAll("[data-home-action-target]").forEach((button) => {
      button.addEventListener("click", () => onNavigate?.(button.dataset.homeActionTarget));
    });
    mountPoint.querySelectorAll("[data-retry-instance]").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await fetch(`/api/quest-instances/${encodeURIComponent(button.dataset.retryInstance)}/retry`, { method: "POST" }).then(responseJson);
          void mountHomePage(mountPoint, onSelectActivity, onNavigate);
        } catch {
          button.disabled = false;
        }
      });
    });
    mountPoint.querySelector("[data-activity-id]")?.addEventListener("click", () => {
      onSelectActivity?.(model.latest.id);
    });
  } catch (error) {
    mountPoint.innerHTML = `<section class="home-page"><p class="home-load-error" role="alert">Unable to load Home: ${escapeHtml(error.message)}</p></section>`;
  }
};
import { ReplayStill, mountReplayStillCard } from "./replay-tab.js";
