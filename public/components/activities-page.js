import { formatDuration } from "./format-duration.js";
import { getAppLocale } from "../app-locales.js";
import { getActivityLabel } from "./activity-labels.js";

const formatNumber = (value, maximumFractionDigits = 0) => new Intl.NumberFormat(getAppLocale(), {
  maximumFractionDigits
}).format(value);

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

export const formatActivityDate = (startedAt) => new Intl.DateTimeFormat(getAppLocale(), {
  day: "2-digit",
  month: "short",
  weekday: "short",
  timeZone: "UTC"
}).format(new Date(startedAt)).toUpperCase();

export const formatActivityDistance = (distanceMeters) => (
  Number.isFinite(distanceMeters) ? `${formatNumber(distanceMeters / 1000, 1)} km` : "Distance unavailable"
);

export const formatActivityDuration = (durationSeconds) => {
  if (!Number.isFinite(durationSeconds)) return "Duration unavailable";
  return formatDuration(durationSeconds);
};

export const activitiesViewModel = (activities) => ({
  activities,
  stats: {
    count: activities.length,
    distanceMeters: activities.reduce((total, activity) => total + (activity.distanceMeters ?? 0), 0),
    xp: activities.reduce((total, activity) => total + activity.xpEarned, 0),
    collected: activities.reduce((total, activity) => total + activity.collectedCount, 0),
    flowlines: activities.reduce((total, activity) => total + (activity.flowlineCount ?? 0), 0)
  }
});

const replayForActivity = (activity) => {
  const replay = activity?.replay;
  if (
    !Array.isArray(replay?.activity?.route)
    || replay.activity.route.length < 2
    || !Array.isArray(replay.activityResult?.collectibles)
    || !Array.isArray(replay.activityResult?.events)
  ) return undefined;
  return replay;
};

export const ActivityCollectibleDots = (activity) => {
  const events = activity.events ?? [];
  if (!events.length) return "";
  return `
    <span class="activity-collectible-dots" aria-label="${activity.collectedCount} new collectibles">
      ${events.slice(0, 5).map(() => "<i></i>").join("")}
      <small>${formatNumber(activity.collectedCount)}</small>
    </span>
  `;
};

export const ActivityStats = ({ count, distanceMeters, xp, collected, flowlines = 0 }) => `
  <p class="activities-stats">
    <span>${formatNumber(count)} ${count === 1 ? "activity" : "activities"} ·</span>
    <strong>${formatNumber(distanceMeters / 1000, 1)} km</strong>
    <span>explored ·</span>
    <strong class="activities-stats-xp">+${formatNumber(xp)} XP</strong>
    <span>earned ·</span>
    <strong>${formatNumber(collected)}</strong>
    <span>collected${flowlines > 0 ? " ·" : ""}</span>
    ${flowlines > 0 ? `<strong>${formatNumber(flowlines)}</strong><span>${flowlines === 1 ? "Flowline" : "Flowlines"}</span>` : ""}
  </p>
`;

export const ActivityMeta = (activity) => {
  const collectibleDots = ActivityCollectibleDots(activity);
  return `
    <div class="activity-meta">
      <div class="activity-meta-heading">
        <p>${escapeHtml(formatActivityDate(activity.startedAt))} · <span class="activity-sport">${escapeHtml(getActivityLabel(activity.type))}</span></p>
        ${activity.hasVideo ? '<span class="activity-pov">POV</span>' : ""}
      </div>
      ${activity.title ? `<p class="activity-title" data-user-content>${escapeHtml(activity.title)}</p>` : ""}
      <div class="activity-measurements">
        <strong>${escapeHtml(formatActivityDistance(activity.distanceMeters).replace(" km", ""))}<span>${Number.isFinite(activity.distanceMeters) ? " km" : ""}</span></strong>
        <span>${escapeHtml(formatActivityDuration(activity.durationSeconds))}</span>
      </div>
      <div class="activity-rewards">
        <span class="activity-xp-chip">+${formatNumber(activity.xpEarned)} XP</span>
        ${activity.flowlineCount > 0 ? `<span class="activity-flowline-chip">${formatNumber(activity.flowlineCount)} ${activity.flowlineCount === 1 ? "Flowline" : "Flowlines"}</span>` : ""}
        ${activity.revisitCount > 0 ? `<span class="activity-revisit-chip">${formatNumber(activity.revisitCount)} revisited</span>` : ""}
      </div>
      ${collectibleDots ? `<div class="activity-collectible-row">${collectibleDots}</div>` : ""}
    </div>
  `;
};

export const ActivityCard = (activity) => `
  <button class="activity-card" type="button" data-activity-id="${escapeHtml(activity.id)}" aria-label="View activity from ${escapeHtml(formatActivityDate(activity.startedAt))}">
    <div class="activity-card-main">
      ${replayForActivity(activity) ? ReplayStill({ canvasLabel: "Route for activity from " + formatActivityDate(activity.startedAt), className: "activity-card-replay" }) : ""}
      <div class="activity-card-content">${ActivityMeta(activity)}</div>
    </div>
  </button>
`;

export const ActivityList = (activities) => `
  <div class="activity-list" aria-label="Activity history">
    ${activities.map(ActivityCard).join("")}
  </div>
`;

export const ActivitiesEmptyState = () => `
  <section class="activities-empty-state">
    <p class="activities-section-label">NO COMPLETED ACTIVITIES YET</p>
    <p>Complete a FIT activity to see your exploration history here.</p>
  </section>
`;

export const ActivitiesPage = (model) => `
  <section class="activities-page" aria-labelledby="activities-title">
    <header class="activities-header">
      <h1 id="activities-title">Activities</h1>
      <p>Your exploration history</p>
    </header>
    ${ActivityStats(model.stats)}
    ${model.activities.length ? ActivityList(model.activities) : ActivitiesEmptyState()}
  </section>
`;

const responseJson = async (response) => {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Unable to load activities.");
  return body;
};

export const mountActivitiesPage = async (mountPoint, onSelectActivity) => {
  mountPoint.innerHTML = '<section class="activities-page"><p class="activities-loading" role="status">Loading activities...</p></section>';
  try {
    const history = await fetch("/api/activities").then(responseJson);
    const activities = await Promise.all(history.map(async (activity) => ({
      ...activity,
      ...(await fetch(`/api/activities/${encodeURIComponent(activity.id)}`).then(responseJson))
    })));
    const model = activitiesViewModel(activities);
    mountPoint.innerHTML = ActivitiesPage(model);
    const basemap = await fetch("/api/world/basemap").then(responseJson).catch(() => undefined);
    mountPoint.querySelectorAll(".activity-card").forEach((card) => {
      const replay = replayForActivity(model.activities.find((activity) => activity.id === card.dataset.activityId));
      if (!replay) return;
      mountReplayStillCard(card, replay, basemap);
    });
    mountPoint.querySelector(".activity-list")?.addEventListener("click", (event) => {
      const card = event.target.closest("[data-activity-id]");
      if (card) onSelectActivity(card.dataset.activityId);
    });
  } catch (error) {
    mountPoint.innerHTML = `<section class="activities-page"><p class="activities-load-error" role="alert">Unable to load activities: ${escapeHtml(error.message)}</p></section>`;
  }
};
import { mountReplayStillCard, ReplayStill } from "./replay-tab.js";
