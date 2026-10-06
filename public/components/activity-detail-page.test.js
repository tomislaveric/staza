import { describe, expect, it } from "vitest";
import { ActivityDetailPage, canCreateQuestFromActivity, CreateQuestAction, nearMissInputs, replayInputs } from "./activity-detail-page.js";
import { activityDistanceLabel, activityDurationLabel } from "./activity-summary.js";

const replay = (nearMisses = []) => ({
  version: 1,
  activity: { source: "fit", route: [{}, {}] },
  activityResult: { collectibles: [], events: [], nearMisses }
});

describe("Activity detail data transformation", () => {
  it("uses only a complete versioned replay snapshot", () => {
    const snapshot = replay();
    expect(replayInputs({ replay: snapshot })).toBe(snapshot);
    expect(replayInputs({})).toBeUndefined();
    expect(replayInputs({ replay: { version: 2 } })).toBeUndefined();
    expect(replayInputs({ replay: { ...snapshot, activity: { source: "fit", route: [] } } })).toBeUndefined();
    const invalidNearMiss = replay([{ collectibleId: "bad", name: "Bad", value: 1, rarity: "invalid", minimumDistanceMeters: 10 }]);
    expect(replayInputs({ replay: invalidNearMiss })).toBe(invalidNearMiss);
    expect(nearMissInputs({ replay: invalidNearMiss })).toBeUndefined();
  });

  it("formats canonical summary values while making missing values explicit", () => {
    expect(activityDistanceLabel(6_680)).toBe("6.7 KM");
    expect(activityDistanceLabel(undefined)).toBe("DISTANCE UNAVAILABLE");
    expect(activityDurationLabel(9_180)).toBe("2h 33m");
    expect(activityDurationLabel(undefined)).toBe("DURATION UNAVAILABLE");
  });

  it("keeps the collected events and near misses available for the replay overlay snapshot", () => {
    const snapshot = replay([
      { collectibleId: "historic-target", name: "Historic Target", value: 100, rarity: "rare", minimumDistanceMeters: 42.4 }
    ]);
    expect(replayInputs({ replay: snapshot })).toBe(snapshot);
    expect(nearMissInputs({ replay: snapshot })).toBe(snapshot);
  });

  it("renders only the REPLAY and VIDEO tabs", () => {
    const page = ActivityDetailPage({
      id: "activity-1", distanceMeters: 1_000, durationSeconds: 600, xpEarned: 25, collectedCount: 1,
      replay: replay()
    }, { level: 1, currentLevelXp: 0, nextLevelXp: 100, progressToNextLevel: 0 }, "replay");
    expect(page).toContain('data-activity-tab="replay"');
    expect(page).toContain('data-activity-tab="video"');
    expect(page).not.toContain('data-activity-tab="collected"');
    expect(page).not.toContain('data-activity-tab="near-misses"');
    expect(page).toContain("data-replay-panel");
  });

  it("keeps the Video tab functional for a valid FIT-only activity", () => {
    const page = ActivityDetailPage({
      id: "activity-1", distanceMeters: 1_000, durationSeconds: 600, xpEarned: 25, collectedCount: 1
    }, { level: 1, currentLevelXp: 0, nextLevelXp: 100, progressToNextLevel: 0 }, "video");
    expect(page).toContain('data-activity-tab="video"');
    expect(page).toContain('aria-selected="true"');
    expect(page).toContain("NO VIDEO ATTACHED");
    expect(page).toContain("ATTACH VIDEO");
    expect(page).toContain('data-upload-dropzone');
    expect(page).toContain('name="video"');
  });

  it("uses only persisted video values in the completed Video tab", () => {
    const page = ActivityDetailPage({
      id: "activity-1", distanceMeters: 1_000, durationSeconds: 600, xpEarned: 25, collectedCount: 1,
      video: {
        state: "succeeded", previewUrl: "/preview", downloadUrl: "/download",
        render: { outputDurationSeconds: 24 }, events: [{
          sourceId: "historic-coin", videoSecond: 6, collectible: { name: "Historic Coin" }
        }]
      }
    }, { level: 1, currentLevelXp: 0, nextLevelXp: 100, progressToNextLevel: 0 }, "video");
    expect(page).toContain("Auto-Generated Highlights");
    expect(page).toContain("Historic Coin");
    expect(page).toContain("/download");
    expect(page).not.toContain("Castle Gate");
  });

  it("renders immediate analysis, selectable highlights, and no-highlight dismissal states", () => {
    const progress = { level: 1, currentLevelXp: 0, nextLevelXp: 100, progressToNextLevel: 0 };
    const base = { id: "activity-1", distanceMeters: 1_000, durationSeconds: 600, xpEarned: 25, collectedCount: 1 };
    const analysing = ActivityDetailPage({ ...base, video: { state: "uploading" } }, progress, "video");
    const selection = ActivityDetailPage({
      ...base,
      video: {
        state: "awaiting_selection",
        events: [{ sourceId: "coin-a", collectible: { name: "Coin A", rarity: "rare", type: "coin" }, value: 100 }]
      }
    }, progress, "video");
    const noHighlights = ActivityDetailPage({ ...base, video: { state: "no_highlights" } }, progress, "video");

    expect(analysing).toContain("Analysing Video");
    expect(analysing).toContain("Reading Video");
    expect(selection).toContain("1 Collectibles Found");
    expect(selection).toContain("Select All");
    expect(selection).toContain("GENERATE HIGHLIGHTS");
    expect(selection).toContain("disabled");
    expect(noHighlights).toContain("NO HIGHLIGHTS FOUND");
    expect(noHighlights).toContain("data-no-highlights-close");
  });

  it("lets an unavailable source video return to the initial upload state", () => {
    const page = ActivityDetailPage({
      id: "activity-1", distanceMeters: 1_000, durationSeconds: 600, xpEarned: 25, collectedCount: 1,
      video: { state: "sync_failed", error: "The FIT activity and video do not overlap in time." }
    }, { level: 1, currentLevelXp: 0, nextLevelXp: 100, progressToNextLevel: 0 }, "video");
    expect(page).toContain("NO HIGHLIGHTS FOUND");
    expect(page).toContain("TRY AGAIN");
    expect(page).toContain("data-video-retry");
    expect(page).not.toContain("The FIT activity and video do not overlap in time.");
  });

  it("offers a quest only for an activity with a replayable route", () => {
    const withRoute = { replay: replay() };
    expect(canCreateQuestFromActivity(withRoute)).toBe(true);
    expect(CreateQuestAction(withRoute)).toContain("CREATE QUEST");
    expect(CreateQuestAction(withRoute)).toContain("data-create-quest");

    const legacy = { distanceMeters: 1_000 };
    expect(canCreateQuestFromActivity(legacy)).toBe(false);
    expect(CreateQuestAction(legacy)).toBe("");
  });

  it("puts the quest action on the detail page without replacing existing actions", () => {
    const page = ActivityDetailPage({
      id: "activity-1", distanceMeters: 1_000, durationSeconds: 600, xpEarned: 25, collectedCount: 1,
      replay: replay()
    }, { level: 1, currentLevelXp: 0, nextLevelXp: 100, progressToNextLevel: 0 }, "replay");
    expect(page).toContain("data-create-quest");
    expect(page).toContain("data-quest-editor");
  });
});
