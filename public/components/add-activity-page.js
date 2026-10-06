import { ActivityFileUpload } from "./activity-file-upload.js";
import { ProcessingState } from "./processing-state.js";
import { UploadError } from "./upload-error.js";
import { UploadStatus } from "./upload-status.js";
import { mountUploadDropzone } from "./upload-dropzone.js";

const importKey = () => crypto.randomUUID();
export const PROCESSING_STEP_DURATION_MS = 1_000;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
})[character]);

const stravaSection = (state) => {
  if (state.stravaLoading) return `<section class="add-activity-strava"><p>STRAVA</p><span>Checking your connection…</span></section>`;
  if (!state.strava?.configured) {
    return `<section class="add-activity-strava"><p>STRAVA</p><span>Strava import is not configured for this environment.</span></section>`;
  }
  if (!state.strava.connected) {
    return `<section class="add-activity-strava">
      <p>STRAVA</p><span>Connect your account to choose a recent activity to import.</span>
      ${state.stravaError ? UploadError({ message: state.stravaError }) : ""}
      <a class="upload-primary-button strava-connect-button" href="/api/integrations/strava/connect">CONNECT STRAVA</a>
    </section>`;
  }
  const reconnect = state.strava.reconnectRequired
    ? `<p class="strava-reconnect-message">Your Strava connection needs to be renewed.</p>
       <a class="upload-primary-button strava-connect-button" href="/api/integrations/strava/connect">RECONNECT STRAVA</a>`
    : "";
  const rows = (state.stravaActivities ?? []).map((activity) => {
    const disabled = !activity.importable;
    const label = activity.beforeJourneyStart ? "Before your Staza journey"
      : activity.alreadyImported ? "Already imported" : "";
    const date = new Date(activity.startedAt).toLocaleString();
    return `<label class="strava-activity${disabled ? " is-disabled" : ""}">
      <input type="radio" name="strava-activity" value="${escapeHtml(activity.externalId)}"
        ${state.selectedStravaId === activity.externalId ? "checked" : ""} ${disabled ? "disabled" : ""}>
      <span class="strava-activity-details">
        <strong>${escapeHtml(activity.name)}</strong>
        <span>${escapeHtml(activity.sportType)} · ${escapeHtml(date)} · ${(activity.distance / 1000).toFixed(1)} km</span>
        ${label ? `<em>${label}</em>` : ""}
      </span>
    </label>`;
  }).join("");
  return `<section class="add-activity-strava">
    <div class="strava-section-heading"><div><p>STRAVA</p><span>Choose one recent activity to import.</span></div>
      <button type="button" class="strava-disconnect-button">DISCONNECT</button></div>
    ${reconnect}
    ${state.stravaError ? UploadError({ message: state.stravaError }) : ""}
    ${state.stravaLoadingActivities ? `<span>Loading recent activities…</span>` :
      rows ? `<div class="strava-activity-list">${rows}</div>` : `<span>No importable activities were found.</span>`}
    <button type="button" class="upload-primary-button strava-import-button"
      ${!state.selectedStravaId || state.stravaImporting || state.strava.reconnectRequired ? "disabled" : ""}>
      ${state.stravaImporting ? "IMPORTING…" : "IMPORT SELECTED ACTIVITY"}
    </button>
  </section>`;
};

const selectedFiles = ({ fit }) => `
  <div class="add-activity-files">
    <section>
      <p>ACTIVITY</p>
      <span>Your activity from Garmin, Wahoo, or any FIT-compatible device</span>
      ${ActivityFileUpload(fit)}
    </section>
  </div>
`;

const content = (state) => {
  if (state.complete) {
    return `${UploadStatus({
      title: "Activity Ready",
      detail: `${state.complete.collectedCount} collectible${state.complete.collectedCount === 1 ? "" : "s"} found along your route`,
      xpEarned: state.complete.xpEarned,
      actionLabel: "VIEW ACTIVITY"
    })}${state.error ? UploadError({ message: `Your activity was saved, but video processing could not start: ${state.error}` }) : ""}`;
  }
  if (state.processing !== undefined) return ProcessingState({ step: state.processing });
  return `
    <header class="add-activity-header">
      <div><h1 id="add-activity-title">Add Activity</h1><p>Upload a FIT file or import one recent Strava activity</p></div>
    </header>
    <form class="add-activity-form" novalidate>
      ${selectedFiles(state)}
      ${state.error ? UploadError({ message: state.error }) : ""}
      <button class="upload-primary-button" type="submit">PROCESS ACTIVITY</button>
    </form>
    ${stravaSection(state)}
  `;
};

export const AddActivityPage = (state = {}) => `
  <section class="add-activity-page" aria-labelledby="add-activity-title">
    <div class="add-activity-panel">${content(state)}</div>
  </section>
`;

export const mountAddActivityPage = (mountPoint, onActivityReady) => {
  const state = {
    fit: undefined, importKey: importKey(), processing: undefined, error: undefined, complete: undefined,
    stravaLoading: true, stravaLoadingActivities: false, stravaActivities: [], stravaImporting: false
  };
  const render = () => {
    mountPoint.innerHTML = AddActivityPage(state);
    if (state.complete) {
      mountPoint.querySelector("[data-upload-complete]")?.addEventListener("click", () => onActivityReady(state.complete.id));
      return;
    }
    if (state.processing) return;
    mountPoint.querySelectorAll("[data-upload-dropzone]").forEach((dropzone) => {
      const input = dropzone.querySelector("input");
      mountUploadDropzone(dropzone, (file) => {
        if (input.name === "fit") state.fit = file;
        state.error = undefined;
        render();
      });
    });
    mountPoint.querySelectorAll("[data-remove-upload]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.removeUpload === "ACTIVITY FILE") state.fit = undefined;
        state.error = undefined;
        render();
      });
    });
    mountPoint.querySelectorAll('input[name="strava-activity"]').forEach((input) => {
      input.addEventListener("change", () => {
        state.selectedStravaId = input.value;
        render();
      });
    });
    mountPoint.querySelector(".strava-disconnect-button")?.addEventListener("click", async () => {
      try {
        const response = await fetch("/api/integrations/strava/disconnect", { method: "POST" });
        if (!response.ok) {
          const body = await response.json();
          throw new Error(body.error ?? "Unable to disconnect Strava.");
        }
        state.strava = { configured: true, connected: false };
        state.stravaActivities = [];
        state.selectedStravaId = undefined;
        state.stravaError = undefined;
      } catch (error) {
        state.stravaError = error instanceof Error ? error.message : "Unable to disconnect Strava.";
      }
      render();
    });
    mountPoint.querySelector(".strava-import-button")?.addEventListener("click", async () => {
      if (!state.selectedStravaId || state.stravaImporting) return;
      state.stravaImporting = true;
      state.stravaError = undefined;
      render();
      try {
        const response = await fetch(
          `/api/integrations/strava/activities/${encodeURIComponent(state.selectedStravaId)}/import`,
          { method: "POST" }
        );
        const body = await response.json();
        if (!response.ok) {
          if (body.code === "STRAVA_RECONNECT_REQUIRED") {
            state.strava = { ...state.strava, reconnectRequired: true };
          }
          throw new Error(body.error ?? "Unable to import Strava activity.");
        }
        state.complete = body.activity;
        state.stravaActivities = state.stravaActivities.map((activity) =>
          activity.externalId === state.selectedStravaId ? { ...activity, alreadyImported: true, importable: false } : activity
        );
      } catch (error) {
        state.stravaError = error instanceof Error ? error.message : "Unable to import Strava activity.";
      } finally {
        state.stravaImporting = false;
        render();
      }
    });
    if (!state.stravaLoaded) {
      state.stravaLoaded = true;
      void loadStrava(state);
    }
    mountPoint.querySelector(".add-activity-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.fit) {
        state.error = "Choose a FIT activity file before processing.";
        render();
        return;
      }
      const data = new FormData();
      data.append("fit", state.fit);
      const request = fetch("/api/activities/import", {
        method: "POST",
        headers: { "Idempotency-Key": state.importKey },
        body: data
      });
      try {
        for (let step = 0; step < 4; step += 1) {
          state.processing = step;
          render();
          await delay(PROCESSING_STEP_DURATION_MS);
        }
        const response = await request;
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Unable to import activity.");
        state.complete = body.activity;
        state.error = body.videoError;
      } catch (error) {
        state.error = error instanceof Error ? error.message : "Unable to import activity.";
      } finally {
        state.processing = undefined;
        render();
      }
    });
  };
  const loadStrava = async (currentState) => {
    try {
      const response = await fetch("/api/integrations/strava/status");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to check Strava connection.");
      currentState.strava = body;
      if (body.connected && !body.reconnectRequired) {
        currentState.stravaLoadingActivities = true;
        const activitiesResponse = await fetch("/api/integrations/strava/activities");
        const activitiesBody = await activitiesResponse.json();
        if (!activitiesResponse.ok) {
          if (activitiesBody.code === "STRAVA_RECONNECT_REQUIRED") {
            currentState.strava = { ...currentState.strava, reconnectRequired: true };
          }
          throw new Error(activitiesBody.error ?? "Unable to load Strava activities.");
        }
        currentState.stravaActivities = activitiesBody.activities ?? [];
      }
    } catch (error) {
      currentState.stravaError = error instanceof Error ? error.message : "Unable to load Strava activities.";
    } finally {
      currentState.stravaLoading = false;
      currentState.stravaLoadingActivities = false;
      render();
    }
  };
  render();
};
