import { getAppLocale } from "../app-locales.js";
import { UploadError } from "./upload-error.js";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

const formatDate = (value) => new Intl.DateTimeFormat(getAppLocale(), { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
const formatDistance = (meters) => `${new Intl.NumberFormat(getAppLocale(), { maximumFractionDigits: 1 }).format(meters / 1000)} km`;

export const stravaNotices = {
  connected: "Strava connected.",
  denied: "Strava access was not granted.",
  missing_scope: "Staza needs access to your Strava activities. Connect again and keep activity access enabled.",
  invalid_state: "The Strava connection could not be verified. Try again.",
  error: "Strava could not be connected. Try again.",
  disconnected: "Strava disconnected.",
  disconnected_local: "Strava disconnected from Staza. You can also revoke access in your Strava settings."
};

const errorMessages = {
  duplicate_activity: "This activity is already in Staza.",
  before_journey_start: "This activity happened before your Staza journey started.",
  reconnect_required: "Your Strava connection expired. Reconnect to continue.",
  not_connected: "Connect Strava to import an activity.",
  rate_limited: "Strava is busy right now. Try again in a few minutes.",
  invalid_streams: "This Strava activity has no usable GPS route.",
  activity_not_found: "This activity is no longer in your recent Strava activities.",
  activity_forbidden: "Staza cannot access this Strava activity.",
  invalid_activity_id: "Choose one Strava activity to import."
};

export const stravaErrorMessage = (code) => errorMessages[code] ?? "Strava could not be reached. Try again.";

const unavailableReason = (activity) => {
  if (activity.importedActivityId) return "Already imported";
  if (activity.beforeJourneyStart) return "Before your journey started";
  if (!activity.hasRoute) return "No GPS route";
  return undefined;
};

const activityOption = (activity, selectedId) => {
  const reason = unavailableReason(activity);
  const details = [
    activity.startDate ? `<span>${escapeHtml(formatDate(activity.startDate))}</span>` : "",
    Number.isFinite(activity.distanceMeters) ? `<span>${escapeHtml(formatDistance(activity.distanceMeters))}</span>` : ""
  ].filter(Boolean).join("<span> · </span>");
  return `<label class="strava-activity${reason ? " is-disabled" : ""}">
    <input type="radio" name="strava-activity" value="${escapeHtml(activity.id)}"${reason ? " disabled" : ""}${selectedId === activity.id ? " checked" : ""}>
    <span><strong data-user-content>${escapeHtml(activity.name)}</strong><small>${details}</small>${reason ? `<em>${reason}</em>` : ""}</span>
  </label>`;
};

const failure = (error) => {
  if (!error) return "";
  const existing = error.existingActivityId
    ? `<button class="strava-link-button" type="button" data-strava-existing="${escapeHtml(error.existingActivityId)}">VIEW EXISTING ACTIVITY</button>`
    : "";
  const journey = error.journeyStartedAt
    ? `<p class="strava-help"><span>Journey started</span> <span>${escapeHtml(formatDate(error.journeyStartedAt))}</span></p>`
    : "";
  return `${UploadError({ message: error.message })}${journey}${existing}`;
};

const recentList = (strava) => {
  if (strava.listLoading) return '<p class="strava-help" role="status">Loading Strava activities...</p>';
  if (!strava.list) return '<button class="strava-secondary-button" type="button" data-strava-action="list">SHOW RECENT STRAVA ACTIVITIES</button>';
  if (strava.list.activities.length === 0) {
    return '<p class="strava-help">No recent Strava activities found.</p><button class="strava-secondary-button" type="button" data-strava-action="list">REFRESH</button>';
  }
  return `<form class="strava-import-form" novalidate>
    <fieldset class="strava-activity-list"><legend>Recent Strava activities</legend>
      ${strava.list.activities.map((activity) => activityOption(activity, strava.selectedId)).join("")}
    </fieldset>
    <p class="strava-help"><span>Only your most recent Strava activities are shown.</span>${strava.list.journeyStartedAt
      ? ` <span>Journey started</span> <span>${escapeHtml(formatDate(strava.list.journeyStartedAt))}</span>`
      : ""}</p>
    <button class="upload-primary-button" type="submit">IMPORT SELECTED ACTIVITY</button>
  </form>`;
};

const body = (strava) => {
  if (strava.status === "disconnected") {
    return `<p class="strava-help">Staza asks Strava for read access to your activities, including private ones. Only your recent activities are listed, and only the one you choose is imported.</p>
      <button class="strava-secondary-button" type="button" data-strava-action="connect">CONNECT STRAVA</button>`;
  }
  if (strava.status === "reconnect_required") {
    return `<button class="strava-secondary-button" type="button" data-strava-action="connect">RECONNECT STRAVA</button>
      <button class="strava-link-button" type="button" data-strava-action="disconnect">Disconnect Strava</button>`;
  }
  return `${recentList(strava)}<button class="strava-link-button" type="button" data-strava-action="disconnect">Disconnect Strava</button>`;
};

/** Renders nothing until the status is known or when the integration is disabled. */
export const StravaImportSection = (strava) => {
  if (!strava || !["disconnected", "connected", "reconnect_required"].includes(strava.status)) return "";
  return `<section class="strava-import" aria-labelledby="strava-import-title">
    <header><p id="strava-import-title">STRAVA</p><span>Import one recent activity from Strava</span></header>
    ${strava.notice ? `<p class="strava-notice" role="status">${escapeHtml(strava.notice)}</p>` : ""}
    ${failure(strava.error)}
    ${body(strava)}
  </section>`;
};

const readJson = async (response) => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(stravaErrorMessage(payload.code));
    error.code = payload.code;
    error.existingActivityId = payload.existingActivityId;
    error.journeyStartedAt = payload.journeyStartedAt;
    throw error;
  }
  return payload;
};

export const requestStravaAuthorization = async (request = fetch) => {
  const { authorizationUrl } = await readJson(await request("/api/integrations/strava/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale: getAppLocale() })
  }));
  window.location.assign(authorizationUrl);
};

export const loadStravaStatus = async (request = fetch) => {
  const status = await readJson(await request("/api/integrations/strava"));
  return status.enabled ? status.status : "disabled";
};

export const disconnectStrava = async (request = fetch) => {
  const result = await readJson(await request("/api/integrations/strava", { method: "DELETE" }));
  return result.remoteRevoked ? stravaNotices.disconnected : stravaNotices.disconnected_local;
};

export const loadRecentStravaActivities = async () => readJson(await fetch("/api/integrations/strava/activities"));

export const startStravaImport = (activityId) => fetch(
  `/api/integrations/strava/activities/${encodeURIComponent(activityId)}/import`,
  { method: "POST" }
).then(readJson);

/** Reads and strips the one-time `?strava=` OAuth callback outcome from the current URL. */
export const consumeStravaCallbackNotice = () => {
  if (typeof window === "undefined") return undefined;
  const params = new URLSearchParams(window.location.search);
  const outcome = params.get("strava");
  if (!outcome) return undefined;
  params.delete("strava");
  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  return { outcome, notice: stravaNotices[outcome] ?? stravaNotices.error };
};
