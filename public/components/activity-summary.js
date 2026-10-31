import { getActivityCompleteLabel, getActivityLabel } from "./activity-labels.js";
import { formatDuration } from "./format-duration.js";
import { getAppLocale } from "../app-locales.js";

const formatNumber = (value, maximumFractionDigits = 0) => new Intl.NumberFormat(getAppLocale(), {
  maximumFractionDigits
}).format(value);

export const activityDistanceLabel = (distanceMeters) => Number.isFinite(distanceMeters)
  ? `${formatNumber(distanceMeters / 1000, 1)} KM`
  : "DISTANCE UNAVAILABLE";

export const activityDurationLabel = (durationSeconds) => {
  if (!Number.isFinite(durationSeconds)) return "DURATION UNAVAILABLE";
  return formatDuration(durationSeconds);
};

const sportIcons = { cycling: "🚴", running: "🏃", hiking: "🥾", walking: "🚶" };

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

/** Distance, duration and collected count, shown inline outside the replay map. */
export const ActivityStats = (activity) => `
  <p class="activity-detail-stats">
    <strong>${activityDistanceLabel(activity.distanceMeters)}</strong>
    <span>${activityDurationLabel(activity.durationSeconds)}</span>
    <span>${formatNumber(activity.collectedCount ?? 0)} collected</span>
  </p>
`;

export const ActivitySummary = (activity) => `
  <header class="activity-detail-summary">
    <p class="activity-detail-eyebrow">${getActivityCompleteLabel(activity.type).toUpperCase()}</p>
    <h1 id="activity-detail-title">
      ${sportIcons[activity.type] ? `<span class="activity-detail-sport-icon" role="img" aria-label="${getActivityLabel(activity.type)}">${sportIcons[activity.type]}</span>` : ""}<span data-user-content>${escapeHtml(activity.title)}</span>
    </h1>
  </header>
`;
