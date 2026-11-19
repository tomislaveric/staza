import { formatDuration } from "./format-duration.js";
import { getAppLocale } from "../app-locales.js";
import { getActivityLabel } from "./activity-labels.js";
import { QuestPill, difficultyLabel, failurePills, questStep } from "./quest-task.js";

const formatNumber = (value, maximumFractionDigits = 0) => new Intl.NumberFormat(getAppLocale(), {
  maximumFractionDigits
}).format(value);

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

const durationLabel = (seconds) => (Number.isFinite(seconds) ? formatDuration(seconds) : undefined);

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

export const homeViewModel = (progress, activities, lifetime) => ({
  progress,
  stats: {
    totalXp: progress.totalXp,
    distanceMeters: lifetime.distanceMeters,
    totalCollected: lifetime.totalCollectibles,
    totalFlowlines: lifetime.totalFlowlines
  },
  latest: activities[0]
});

export const HomePlayerProgress = ({ progress, stats }) => `
  <section class="home-hero" aria-label="Player progress">
    <div class="home-progress">
      <strong class="home-level">${formatNumber(progress.level)}</strong>
      <div class="home-progress-details">
        <p class="home-section-label">LEVEL ${formatNumber(progress.level)}</p>
        <p class="home-xp"><strong>${formatNumber(progress.currentLevelXp)}</strong> <span>/ ${formatNumber(progress.nextLevelXp)} XP</span></p>
        <div class="home-xp-track" role="progressbar" aria-valuemin="0" aria-valuemax="${progress.nextLevelXp}" aria-valuenow="${progress.currentLevelXp}">
          <span style="width: ${progress.progressPercent}%"></span>
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

const HIGHLIGHT_LIMIT = 3;
const DIFFICULTY_RANK = { easy: 0, medium: 1, hard: 2, prestige: 3 };
const difficultyRank = (difficulty) => DIFFICULTY_RANK[difficulty] ?? Object.keys(DIFFICULTY_RANK).length;

/** The easiest active authored quest: lowest difficulty, then lowest XP, then catalog order. */
export const featuredQuest = (quests = []) => (quests ?? [])
  .map((quest, index) => ({ quest, index }))
  .filter(({ quest }) => quest.state === "active")
  .sort((a, b) => difficultyRank(a.quest.difficulty) - difficultyRank(b.quest.difficulty)
    || (a.quest.xp ?? 0) - (b.quest.xp ?? 0)
    || a.index - b.index)[0]?.quest;

/** Average requirement completion, each requirement capped at 100%; 1 when there are none. */
export const requirementProgress = (node) => {
  const requirements = node.requirements ?? [];
  if (!requirements.length) return 1;
  return requirements.reduce((sum, requirement) => sum + (requirement.met || !(requirement.target > 0)
    ? 1
    : Math.max(0, Math.min(1, requirement.current / requirement.target))), 0) / requirements.length;
};

/** Unlockable Skill Atlas nodes, cheapest first. */
export const readyNodes = (nodes = []) => (nodes ?? [])
  .map((node, index) => ({ node, index }))
  .filter(({ node }) => node.state === "unlockable")
  .sort((a, b) => a.node.cost - b.node.cost || a.index - b.index)
  .slice(0, HIGHLIGHT_LIMIT)
  .map(({ node }) => node);

/** Started, locked nodes whose prerequisites are met, closest to unlockable first. */
export const almostNodes = (nodes = []) => (nodes ?? [])
  .map((node, index) => ({ node, index, progress: requirementProgress(node) }))
  .filter(({ node, progress }) => node.state === "locked" && node.prerequisitesMet && progress > 0)
  .sort((a, b) => b.progress - a.progress || a.node.cost - b.node.cost || a.index - b.index)
  .slice(0, HIGHLIGHT_LIMIT)
  .map(({ node, progress }) => ({ node, progress }));

/** The unmet requirement with the least progress, which is what keeps the node locked longest. */
const blockingRequirement = (node) => (node.requirements ?? [])
  .filter((requirement) => !requirement.met)
  .sort((a, b) => (a.current / a.target) - (b.current / b.target))[0];

export const homeHighlights = ({ skillPoints = 0, authoredQuests = [], instances = [], nodes = [] } = {}) => {
  const activeQuests = (authoredQuests ?? []).filter((quest) => quest.state === "active");
  return {
    quest: featuredQuest(activeQuests),
    activeQuestCount: activeQuests.length,
    exploration: (instances ?? []).find((instance) => instance.status === "active"),
    skillPoints: skillPoints ?? 0,
    ready: readyNodes(nodes),
    almost: almostNodes(nodes)
  };
};

const decimal = (value) => formatNumber(value, value % 1 === 0 ? 0 : 1);

const UpNextQuest = (quest, moreCount) => `
  <button type="button" class="home-up-next-card" data-home-action-target="progress" data-home-up-next="quest:${escapeHtml(quest.id)}">
    <span class="home-up-next-kicker">
      <span data-user-content>${escapeHtml(quest.chainTitle ?? "Quest")}</span>
      ${questStep(quest)}${quest.isNew ? QuestPill("NEW", "new") : ""}
    </span>
    <strong class="home-up-next-title" data-user-content>${escapeHtml(quest.title)}</strong>
    <span class="home-up-next-goal" data-user-content>${escapeHtml(quest.description)}</span>
    ${quest.lastFailure ? `<span class="quest-pills">${failurePills(quest)}</span>` : ""}
    <span class="home-up-next-footer">
      <span class="quest-pills">${QuestPill(difficultyLabel(quest.difficulty), "muted")}</span>
      <span class="home-up-next-reward">+${formatNumber(quest.xp)} XP</span>
    </span>
  </button>
  ${moreCount > 0 ? `<button type="button" class="home-up-next-more" data-home-action-target="progress">${formatNumber(moreCount)} more active quest${moreCount === 1 ? "" : "s"} <span aria-hidden="true">›</span></button>` : ""}
`;

const UpNextExploration = (exploration, { compact = false } = {}) => `
  <button type="button" class="${compact ? "home-up-next-side" : "home-up-next-card is-exploration"}" data-home-action-target="world" data-home-up-next="exploration:${escapeHtml(exploration.id)}">
    <span class="home-up-next-kicker">EXPLORATION</span>
    <strong class="home-up-next-title" data-user-content>${escapeHtml(exploration.title)}</strong>
    ${compact ? "" : `<span class="home-up-next-goal" data-user-content>${escapeHtml(exploration.description ?? "")}</span>`}
    ${Number.isFinite(exploration.rewardXp) ? `<span class="home-up-next-reward">+${formatNumber(exploration.rewardXp)} XP</span>` : ""}
  </button>
`;

const UpNextPlan = () => `
  <button type="button" class="home-up-next-card is-plan" data-home-action-target="world" data-home-up-next="plan-exploration">
    <span class="home-up-next-kicker">WORLD</span>
    <strong class="home-up-next-title">Plan an exploration</strong>
    <span class="home-up-next-goal">Pick an area in World and turn it into a route with targets to collect.</span>
  </button>
`;

/** One featured next step: the easiest quest, else an active exploration, else planning one. */
export const HomeUpNext = ({ quest, activeQuestCount = 0, exploration } = {}) => `
  <section class="home-up-next" aria-labelledby="home-up-next-title" data-home-up-next-section>
    <div class="home-section-heading"><h1 id="home-up-next-title">UP NEXT</h1></div>
    ${quest
    ? `${UpNextQuest(quest, activeQuestCount - 1)}${exploration ? UpNextExploration(exploration, { compact: true }) : ""}`
    : exploration ? UpNextExploration(exploration) : UpNextPlan()}
  </section>
`;

const sportLabel = (sport) => getActivityLabel(sport, 2).toUpperCase();

const ReadyNode = (node) => `
  <li><button type="button" class="home-skill-card is-ready" data-home-skill-node="${escapeHtml(node.id)}">
    <span class="home-skill-sport">${escapeHtml(sportLabel(node.sport))}</span>
    <strong data-user-content>${escapeHtml(node.name)}</strong>
    <span class="home-skill-grant" data-user-content>${escapeHtml(node.grant?.label ?? node.description ?? "")}</span>
    <span class="home-skill-cta">Unlock · ${formatNumber(node.cost)} SP</span>
  </button></li>
`;

const AlmostNode = ({ node, progress }, skillPoints) => {
  const requirement = blockingRequirement(node);
  const missing = Math.max(0, node.cost - skillPoints);
  const hint = requirement
    ? `<span data-user-content>${escapeHtml(requirement.label)}</span><b>${decimal(requirement.current)}/${decimal(requirement.target)}</b>`
    : `<span>Needs ${formatNumber(missing || node.cost)} more SP</span>`;
  return `
  <li><button type="button" class="home-skill-card is-almost" data-home-skill-node="${escapeHtml(node.id)}">
    <span class="home-skill-sport">${escapeHtml(sportLabel(node.sport))}</span>
    <strong data-user-content>${escapeHtml(node.name)}</strong>
    <span class="home-skill-hint">${hint}</span>
    <span class="home-skill-track" role="progressbar" aria-label="${escapeHtml(node.name)} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress * 100)}"><i style="width: ${Math.round(progress * 100)}%"></i></span>
  </button></li>
`;
};

/** Skill Atlas nodes the player can unlock now and nodes that are close. */
export const HomeSkillHighlights = ({ skillPoints = 0, ready = [], almost = [] } = {}) => {
  if (!ready.length && !almost.length && skillPoints <= 0) return "";
  return `
  <section class="home-skill-highlights" aria-labelledby="home-skill-highlights-title" data-home-skill-highlights>
    <div class="home-section-heading">
      <h1 id="home-skill-highlights-title">SKILL ATLAS</h1>
      ${skillPoints > 0 ? `<b class="home-tile-flag" data-home-skill-points-balance>${formatNumber(skillPoints)} SP to spend</b>` : ""}
    </div>
    ${ready.length ? `<div class="home-skill-group"><p class="home-section-label">READY TO UNLOCK</p><ul class="home-skill-cards">${ready.map(ReadyNode).join("")}</ul></div>` : ""}
    ${!ready.length && skillPoints > 0 ? `<button type="button" class="home-up-next-more" data-home-action-target="skill-tree">Spend ${formatNumber(skillPoints)} Skill Point${skillPoints === 1 ? "" : "s"} in the Skill Atlas <span aria-hidden="true">›</span></button>` : ""}
    ${almost.length ? `<div class="home-skill-group"><p class="home-section-label">ALMOST THERE</p><ul class="home-skill-cards">${almost.map((item) => AlmostNode(item, skillPoints)).join("")}</ul></div>` : ""}
  </section>
`;
};

export const HomeOnboarding = () => `
  <section class="home-onboarding" aria-labelledby="onboarding-title" data-home-onboarding>
    <small>WELCOME TO STAZA</small>
    <h2 id="onboarding-title">Turn real rides, runs and hikes into a game</h2>
    <p>Staza finds the places you pass on real routes. Collect them for XP, level up, spend Skill Points in the Skill Atlas and complete quests.</p>
    <ol>
      <li>Add an activity from a FIT or GPX file or Strava.</li>
      <li>Watch the replay and see what changed.</li>
      <li>Pick a quest or plan an exploration for your next outing.</li>
    </ol>
    <button type="button" class="home-next-action-cta" data-home-action-target="add-activity">Add your first activity</button>
  </section>
`;

const pct = (value, total) => (total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0);

export const HomeAchievements = ({ unlocked = [], totalNodes = 0, titles = [], badges = [], stats } = {}) => {
  const earned = [...titles, ...badges];
  return `
  <section class="home-achievements" aria-labelledby="achievements-title">
    <div class="home-section-heading"><h1 id="achievements-title">SKILLS &amp; ACHIEVEMENTS</h1></div>
    <div class="home-tiles">
      <button type="button" class="home-tile" data-home-skill-tree>
        <small>SKILLS</small>
        <strong data-home-unlocked-count>${unlocked.length}<em> / ${totalNodes}</em></strong>
        <span class="quest-progress-track" aria-hidden="true"><i style="width: ${pct(unlocked.length, totalNodes)}%;"></i></span>
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
  </section>
`;
};

export const HomePage = (model) => {
  const highlights = homeHighlights({
    skillPoints: model.achievements?.skillPoints,
    authoredQuests: model.achievements?.authoredQuests,
    instances: model.activeQuests,
    nodes: model.achievements?.nodes
  });
  return `
  <section class="home-page">
    ${HomePlayerProgress(model)}
    ${model.latest ? HomeUpNext(highlights) : HomeOnboarding()}
    ${HomeSkillHighlights(highlights)}
    ${HomeAchievements({ ...model.achievements, stats: model.stats })}
    ${HomeRecentActivity(model.latest)}
  </section>
`;
};

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
      nodes: tree.nodes,
      titles: capabilities.titles,
      badges: capabilities.badges,
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
      activeQuests: questBody.instances,
      achievements
    };
    mountPoint.innerHTML = HomePage(model);
    const replay = replayForHome(model.latest);
    if (replay) {
      const basemap = await fetch("/api/world/basemap").then(responseJson).catch(() => undefined);
      mountReplayStillCard(mountPoint.querySelector(".home-activity-card"), replay, basemap);
    }
    mountPoint.querySelector("[data-home-skill-tree]")?.addEventListener("click", () => onNavigate?.("skill-tree"));
    mountPoint.querySelectorAll("[data-home-skill-node]").forEach((button) => {
      button.addEventListener("click", () => onNavigate?.("skill-tree", undefined, button.dataset.homeSkillNode));
    });
    mountPoint.querySelectorAll("[data-home-action-target]").forEach((button) => {
      button.addEventListener("click", () => onNavigate?.(button.dataset.homeActionTarget));
    });
    mountPoint.querySelector("[data-activity-id]")?.addEventListener("click", () => {
      onSelectActivity?.(model.latest.id);
    });
  } catch (error) {
    mountPoint.innerHTML = `<section class="home-page"><p class="home-load-error" role="alert">Unable to load Home: ${escapeHtml(error.message)}</p></section>`;
  }
};
import { ReplayStill, mountReplayStillCard } from "./replay-tab.js";
