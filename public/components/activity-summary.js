import { getActivityCompleteLabel } from "./activity-labels.js";
import { getAppLocale } from "../app-locales.js";

const formatNumber = (value, maximumFractionDigits = 0) => new Intl.NumberFormat(getAppLocale(), {
  maximumFractionDigits
}).format(value);

export const activityDistanceLabel = (distanceMeters) => Number.isFinite(distanceMeters)
  ? `${formatNumber(distanceMeters / 1000, 1)} KM`
  : "DISTANCE UNAVAILABLE";

export const activityDurationLabel = (durationSeconds) => {
  if (!Number.isFinite(durationSeconds)) return "DURATION UNAVAILABLE";
  const hours = Math.floor(durationSeconds / 3600);
  const minutes = Math.floor((durationSeconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};

const sportOptions = [["cycling", "Cycling"], ["running", "Running"], ["hiking", "Hiking"], ["unknown", "Not set"]];

export const ActivitySportControl = (activity) => `
  <label class="activity-detail-sport">
    <span>Sport</span>
    <select data-activity-sport>
      ${sportOptions.map(([value, label]) => `<option value="${value}"${(activity.type ?? "unknown") === value ? " selected" : ""}>${label}</option>`).join("")}
      ${sportOptions.some(([value]) => value === activity.type) || !activity.type ? "" : `<option value="${activity.type}" selected>${activity.type}</option>`}
    </select>
  </label>
`;

export const ActivitySummary = (activity) => `
  <header class="activity-detail-summary">
    <p class="activity-detail-eyebrow">${getActivityCompleteLabel(activity.type).toUpperCase()}</p>
    <h1 id="activity-detail-title">${activityDistanceLabel(activity.distanceMeters)}</h1>
    <p class="activity-detail-duration">${activityDurationLabel(activity.durationSeconds)}</p>
    ${ActivitySportControl(activity)}
    <p class="activity-detail-sport-error" role="alert" hidden></p>
  </header>
`;
