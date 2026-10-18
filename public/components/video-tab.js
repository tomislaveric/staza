const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&#39;"
})[character]);

const duration = (seconds) => {
  if (!Number.isFinite(seconds)) return "";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
};

const errorCopy = (video) => video.synchronization?.code
  ? `We could not synchronize this video (${video.synchronization.code}).`
  : video.error ?? "We could not process this video.";

const VideoEmptyState = () => `
  <section class="video-empty-state" aria-label="Activity video">
    <p>NO VIDEO ATTACHED</p><h2>Add your activity video</h2>
    <span>No video attached to this activity yet. Video is optional—add your GoPro or action-camera footage to create automatic highlights.</span>
    <form data-video-upload><div data-video-upload-fields>${VideoFileUpload({ optional: false })}</div><button class="video-attach-button">ATTACH VIDEO</button></form>
  </section>
`;

const VideoProcessingState = (video) => `
  <section class="video-processing-state" aria-live="polite">
    <p>${video.state === "rendering" ? "CREATING HIGHLIGHTS" : "ANALYSING VIDEO"}</p>
    <h2>${video.state === "rendering" ? "Rendering selected moments" : "Analysing Video"}</h2>
    <span>${video.state === "rendering" ? "Your selected highlights are rendering." : "Matching footage to your activity data"}</span>
    ${video.state === "rendering"
      ? UploadProgress({ label: "Rendering your selected moments." })
      : `<ol class="video-analysis-steps">
        <li class="${video.state === "uploading" ? "is-active" : "is-complete"}"><i></i><span>Reading Video</span></li>
        <li class="${video.state === "uploading" ? "is-pending" : "is-active"}"><i></i><span>Reading FIT File</span></li>
        <li class="is-pending"><i></i><span>Searching Collectibles</span></li>
      </ol>`}
  </section>
`;

const VideoErrorState = (video) => `
  <section class="video-error-state" role="alert">
    <p>HIGHLIGHT FAILED</p>
    <h2>${escapeHtml(errorCopy(video))}</h2>
    <span>Your activity and collected items are unchanged.</span>
    ${UploadError({ message: "Your source video is preserved." })}
  </section>
`;

const VideoSelection = (video) => `
  <section class="video-selection" aria-label="Highlight selection">
    <div class="video-selection-heading"><div><h2>${video.events?.length ?? 0} Collectibles Found</h2><span>Select which moments to include in your highlight video</span></div><button type="button" data-select-all>Select All</button></div>
    <form data-video-selection>
      <ul>${(video.events ?? []).map((event) => `<li><label><input type="checkbox" name="sourceId" value="${escapeHtml(event.sourceId)}"><i></i><span><b data-user-content>${escapeHtml(event.collectible.name)}</b><small data-user-content>${escapeHtml(event.collectible.type)}</small></span><em>+${escapeHtml(event.value)} XP</em></label></li>`).join("")}</ul>
      <button class="video-attach-button" type="submit" disabled>GENERATE HIGHLIGHTS</button>
    </form>
  </section>
`;

const VideoNoHighlightsState = ({ retry = false } = {}) => `
  <section class="video-no-highlights" role="status">
    <div><p>NO HIGHLIGHTS FOUND</p><h2>No collectible moments were found in this video.</h2><span>${retry ? "This video could not be matched to the moments collected on this activity." : "Your source video is attached, but none of this activity’s collected events map to its timeline."}</span></div>
    <button type="button" ${retry ? "data-video-retry" : "data-no-highlights-close"}>${retry ? "TRY AGAIN" : "CLOSE"}</button>
  </section>
`;

const HighlightReadyState = (video) => {
  const events = video.events ?? [];
  const outputDuration = video.render?.outputDurationSeconds;
  return `
    <section class="video-player" aria-label="Auto-generated highlights">
      <div class="video-player-frame">
        <video controls preload="metadata" src="${escapeHtml(video.previewUrl)}"></video>
        <span class="video-rec">● REC</span><span class="video-duration">${duration(outputDuration)}</span>
      </div>
      <div class="video-player-title"><strong>Auto-Generated Highlights</strong><span>${events.length} ${events.length === 1 ? "moment" : "moments"}${Number.isFinite(outputDuration) ? ` · ${duration(outputDuration)}` : ""}</span></div>
      ${video.downloadUrl ? `<a class="video-download" href="${escapeHtml(video.downloadUrl)}">DOWNLOAD VIDEO</a>` : ""}
      <ul class="video-event-list">${events.map((event) => `<li><time>${duration(event.videoSecond)}</time><i></i><strong data-user-content>${escapeHtml(event.collectible.name)}</strong></li>`).join("")}</ul>
    </section>
  `;
};

export const VideoTab = (activity) => {
  const video = activity.video;
  if (!video) return VideoEmptyState();
  if (video.state === "uploading" || video.state === "syncing" || video.state === "rendering") return VideoProcessingState(video);
  if (video.state === "sync_failed") return VideoNoHighlightsState({ retry: true });
  if (video.state === "render_failed") return VideoErrorState(video);
  if (video.state === "no_highlights") return VideoNoHighlightsState();
  if (video.state === "awaiting_selection") return VideoSelection(video);
  return HighlightReadyState(video);
};

export const mountVideoTab = (mountPoint, activity, onActivityUpdated) => {
  const showError = (error) => {
    const state = mountPoint.querySelector(".activity-detail-tab-content");
    if (state) state.insertAdjacentHTML("afterbegin", `<p class="activity-detail-state activity-detail-error" role="alert">${escapeHtml(error instanceof Error ? error.message : "Unable to update activity video.")}</p>`);
  };
  const upload = mountPoint.querySelector("[data-video-upload]");
  let selectedVideo;
  const bindUploadDropzone = () => {
    const fields = mountPoint.querySelector("[data-video-upload-fields]");
    const dropzone = fields?.querySelector("[data-upload-dropzone]");
    if (dropzone) {
      mountUploadDropzone(dropzone, (file) => {
        selectedVideo = file;
        fields.innerHTML = VideoFileUpload({ file });
        fields.querySelector("[data-remove-upload]")?.addEventListener("click", () => {
          selectedVideo = undefined;
          fields.innerHTML = VideoFileUpload({ optional: false });
          bindUploadDropzone();
        });
      });
    }
  };
  bindUploadDropzone();
  if (upload) upload.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = new FormData();
      const file = selectedVideo ?? upload.querySelector("input[name=video]")?.files?.[0];
      if (!file) throw new Error("Choose a video file before attaching it.");
      if (file) data.append("video", file);
      onActivityUpdated({
        ...activity,
        video: { mediaId: "uploading", sourceFilename: file.name, state: "uploading" }
      });
      const response = await fetch(`/api/activities/${encodeURIComponent(activity.id)}/video`, { method: "POST", body: data });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      onActivityUpdated({ ...activity, video: body.video });
    } catch (error) {
      onActivityUpdated(activity);
      showError(error);
    }
  });
  const selection = mountPoint.querySelector("[data-video-selection]");
  if (selection) selection.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const sourceIds = [...selection.querySelectorAll("input:checked")].map((input) => input.value);
      const response = await fetch(`/api/activities/${encodeURIComponent(activity.id)}/video/render`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceIds })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      onActivityUpdated({ ...activity, video: body.video });
    } catch (error) {
      showError(error);
    }
  });
  const selectAll = mountPoint.querySelector("[data-select-all]");
  const selectionSubmit = mountPoint.querySelector("[data-video-selection] button[type=submit]");
  const selections = [...mountPoint.querySelectorAll("[data-video-selection] input[name=sourceId]")];
  const updateSelection = () => {
    const allSelected = selections.length > 0 && selections.every((input) => input.checked);
    const selectedCount = selections.filter((input) => input.checked).length;
    if (selectAll) selectAll.textContent = allSelected ? "Clear All" : "Select All";
    if (selectionSubmit) selectionSubmit.disabled = selectedCount === 0;
  };
  selectAll?.addEventListener("click", () => {
    const select = !selections.every((input) => input.checked);
    selections.forEach((input) => { input.checked = select; });
    updateSelection();
  });
  selections.forEach((input) => input.addEventListener("change", updateSelection));
  mountPoint.querySelector("[data-no-highlights-close]")?.addEventListener("click", () => {
    const state = mountPoint.querySelector(".activity-detail-tab-content");
    if (state) state.replaceChildren();
  });
  mountPoint.querySelector("[data-video-retry]")?.addEventListener("click", async (event) => {
    const retry = event.currentTarget;
    try {
      retry.disabled = true;
      const response = await fetch(`/api/activities/${encodeURIComponent(activity.id)}/video`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error);
      }
      onActivityUpdated({ ...activity, video: undefined });
    } catch (error) {
      retry.disabled = false;
      showError(error);
    }
  });
};
import { UploadError } from "./upload-error.js";
import { UploadProgress } from "./upload-progress.js";
import { VideoFileUpload } from "./video-file-upload.js";
import { mountUploadDropzone } from "./upload-dropzone.js";
