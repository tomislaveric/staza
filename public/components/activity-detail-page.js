import { canonicalRarity } from "./collected-list.js";
import { ActivityProgress } from "./activity-progress.js";
import { ReplayTab, mountReplayTab } from "./replay-tab.js";
import { ActivitySummary } from "./activity-summary.js";
import { ActivityTabs } from "./activity-tabs.js";
import { VideoTab, mountVideoTab } from "./video-tab.js";

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

const responseJson = async (response) => {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Unable to load activity detail.");
  return body;
};

export const replayInputs = (activity) => {
  const replay = activity.replay;
  if (
    replay?.version !== 1
    || !["fit", "strava"].includes(replay.activity?.source)
    || !Array.isArray(replay.activity.route)
    || replay.activity.route.length < 2
    || !Array.isArray(replay.activityResult?.collectibles)
    || !Array.isArray(replay.activityResult?.events)
    || !Array.isArray(replay.activityResult?.nearMisses)
  ) return undefined;
  return replay;
};

export const nearMissInputs = (activity) => {
  const replay = replayInputs(activity);
  if (!replay?.activityResult.nearMisses.every((nearMiss) => (
    typeof nearMiss?.collectibleId === "string"
    && typeof nearMiss.name === "string"
    && Number.isFinite(nearMiss.value)
    && Number.isFinite(nearMiss.minimumDistanceMeters)
    && (nearMiss.rarity === undefined || canonicalRarity(nearMiss.rarity) !== undefined)
  ))) return undefined;
  return replay;
};

const ReplayUnavailable = () => '<p class="activity-detail-state" role="status">Replay data is unavailable for this legacy activity.</p>';

export const ActivityDetailPage = (activity, progress, selectedTab = "replay") => {
  const replay = replayInputs(activity);
  const tabContent = selectedTab === "video"
    ? VideoTab(activity)
    : (replay ? ReplayTab() : ReplayUnavailable());
  return `
    <section class="activity-detail-page" aria-labelledby="activity-detail-title">
      <div class="activity-detail-toolbar">
        <button class="activity-detail-back" type="button"><img src="/assets/activity-detail-back.svg" width="16" height="16" alt="">BACK</button>
      </div>
      ${ActivitySummary(activity)}
      ${ActivityProgress(activity, progress)}
      ${ActivityTabs(activity, selectedTab)}
      <div class="activity-detail-tab-content">${tabContent}</div>
    </section>
  `;
};

export const mountActivityDetailPage = async (mountPoint, activityId, onBack) => {
  mountPoint.innerHTML = '<section class="activity-detail-page"><p class="activity-detail-state" role="status">Loading activity detail...</p></section>';
  try {
    const [loadedActivity, progress] = await Promise.all([
      fetch(`/api/activities/${encodeURIComponent(activityId)}`).then(responseJson),
      fetch("/api/player/progress").then(responseJson)
    ]);
    let basemap;
    const loadBasemap = async () => {
      if (!basemap) basemap = await fetch("/api/world/basemap").then(responseJson).catch(() => undefined);
      return basemap;
    };
    let activity = loadedActivity;
    let selectedTab = "replay";
    let polling;
    let disposeReplay;
    const render = (tab) => {
      selectedTab = tab;
      clearTimeout(polling);
      disposeReplay?.();
      disposeReplay = undefined;
      mountPoint.innerHTML = ActivityDetailPage(activity, progress, selectedTab);
      mountPoint.querySelector(".activity-detail-back").addEventListener("click", onBack);
      mountPoint.querySelectorAll("[data-activity-tab]").forEach((tab) => {
        tab.addEventListener("click", () => render(tab.dataset.activityTab));
      });
      const replay = replayInputs(activity);
      if (selectedTab === "replay" && replay) {
        void loadBasemap().then((config) => {
          if (selectedTab === "replay") disposeReplay = mountReplayTab(mountPoint, replay, config);
        });
      }
      if (selectedTab === "video") {
        mountVideoTab(mountPoint, activity, (updatedActivity) => {
          activity = updatedActivity;
          render("video");
          if (activity.video?.state === "syncing" || activity.video?.state === "rendering") pollVideo();
        });
      }
    };
    const pollVideo = async () => {
      try {
        const response = await fetch(`/api/activities/${encodeURIComponent(activityId)}`);
        const updated = await responseJson(response);
        activity = updated;
        if (selectedTab === "video") render("video");
        if (activity.video?.state === "syncing" || activity.video?.state === "rendering") polling = setTimeout(pollVideo, 1500);
      } catch (error) {
        if (selectedTab === "video") mountPoint.querySelector(".activity-detail-tab-content").innerHTML = `<p class="activity-detail-state activity-detail-error" role="alert">${escapeHtml(error.message)}</p>`;
      }
    };
    render("replay");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load activity detail.";
    mountPoint.innerHTML = `<section class="activity-detail-page"><button class="activity-detail-back" type="button"><img src="/assets/activity-detail-back.svg" width="16" height="16" alt="">BACK</button><p class="activity-detail-state activity-detail-error" role="alert">${escapeHtml(message)}</p></section>`;
    mountPoint.querySelector(".activity-detail-back").addEventListener("click", onBack);
  }
};
