import { ActivityFileUpload } from "./activity-file-upload.js";
import { ProcessingState } from "./processing-state.js";
import { UploadError } from "./upload-error.js";
import { UploadStatus } from "./upload-status.js";
import { mountUploadDropzone } from "./upload-dropzone.js";
import {
  StravaImportSection,
  consumeStravaCallbackNotice,
  disconnectStrava,
  loadRecentStravaActivities,
  loadStravaStatus,
  requestStravaAuthorization,
  startStravaImport
} from "./strava-import.js";

const importKey = () => crypto.randomUUID();
export const PROCESSING_STEP_DURATION_MS = 1_000;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
      <div><h1 id="add-activity-title">Add Activity</h1><p>Import a FIT file to start discovering</p></div>
    </header>
    <form class="add-activity-form" novalidate>
      ${selectedFiles(state)}
      ${state.error ? UploadError({ message: state.error }) : ""}
      <button class="upload-primary-button" type="submit">PROCESS ACTIVITY</button>
    </form>
    ${StravaImportSection(state.strava)}
  `;
};

export const AddActivityPage = (state = {}) => `
  <section class="add-activity-page" aria-labelledby="add-activity-title">
    <div class="add-activity-panel">${content(state)}</div>
  </section>
`;

export const mountAddActivityPage = (mountPoint, onActivityReady) => {
  const callback = consumeStravaCallbackNotice();
  const state = {
    fit: undefined,
    importKey: importKey(),
    processing: undefined,
    error: undefined,
    complete: undefined,
    strava: { status: "loading", notice: callback?.notice }
  };
  const process = async (request) => {
    try {
      for (let step = 0; step < 4; step += 1) {
        state.processing = step;
        render();
        await delay(PROCESSING_STEP_DURATION_MS);
      }
      return await request;
    } finally {
      state.processing = undefined;
    }
  };
  const updateStrava = (changes) => {
    state.strava = { ...state.strava, notice: undefined, error: undefined, ...changes };
    // The page may have been replaced by another screen while a Strava request was pending.
    if (!mountPoint.querySelector(".add-activity-page")) return;
    render();
  };
  const stravaFailure = (error) => {
    if (error?.code === "reconnect_required" || error?.code === "not_connected") {
      updateStrava({ status: error.code === "not_connected" ? "disconnected" : "reconnect_required", list: undefined, listLoading: false });
    }
    updateStrava({ listLoading: false, error: {
      message: error instanceof Error ? error.message : "Strava could not be reached. Try again.",
      existingActivityId: error?.existingActivityId,
      journeyStartedAt: error?.journeyStartedAt
    } });
  };
  const listStrava = async () => {
    updateStrava({ listLoading: true, list: undefined, selectedId: undefined });
    try {
      updateStrava({ listLoading: false, list: await loadRecentStravaActivities() });
    } catch (error) { stravaFailure(error); }
  };
  const stravaActions = {
    connect: async () => {
      try { await requestStravaAuthorization(); } catch (error) { stravaFailure(error); }
    },
    disconnect: async () => {
      try { updateStrava({ status: "disconnected", list: undefined, notice: await disconnectStrava() }); } catch (error) { stravaFailure(error); }
    },
    list: listStrava
  };
  const bindStrava = () => {
    mountPoint.querySelectorAll("[data-strava-action]").forEach((button) => {
      button.addEventListener("click", () => stravaActions[button.dataset.stravaAction]?.());
    });
    mountPoint.querySelector("[data-strava-existing]")?.addEventListener("click", (event) => {
      onActivityReady(event.currentTarget.dataset.stravaExisting);
    });
    mountPoint.querySelectorAll('input[name="strava-activity"]').forEach((input) => {
      input.addEventListener("change", () => { state.strava.selectedId = input.value; });
    });
    mountPoint.querySelector(".strava-import-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const activityId = state.strava.selectedId;
      if (!activityId) {
        updateStrava({ error: { message: "Choose one Strava activity to import." } });
        return;
      }
      state.error = undefined;
      try {
        const body = await process(startStravaImport(activityId));
        state.complete = body.activity;
        render();
      } catch (error) {
        stravaFailure(error);
      }
    });
  };
  const render = () => {
    mountPoint.innerHTML = AddActivityPage(state);
    if (state.complete) {
      mountPoint.querySelector("[data-upload-complete]")?.addEventListener("click", () => onActivityReady(state.complete.id));
      return;
    }
    if (state.processing !== undefined) return;
    bindStrava();
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
        const response = await process(request);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Unable to import activity.");
        state.complete = body.activity;
        state.error = body.videoError;
      } catch (error) {
        state.error = error instanceof Error ? error.message : "Unable to import activity.";
      } finally {
        render();
      }
    });
  };
  render();
  loadStravaStatus()
    .then((status) => updateStrava({ status, notice: state.strava.notice }))
    .catch(() => updateStrava({ status: "disabled" }));
};
