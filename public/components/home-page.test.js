import { describe, expect, it } from "vitest";
import { HomeActiveQuests, HomeActiveQuestCard, HomeRecentActivity, activeQuestInstances, homeViewModel } from "./home-page.js";

describe("Home data transformation", () => {
  const progress = { totalXp: 700, level: 4, currentLevelXp: 100, nextLevelXp: 400, progressToNextLevel: .25 };
  const activities = [{
    id: "latest", distanceMeters: 5_400, durationSeconds: 1200, xpEarned: 40, collectedCount: 2,
    events: [{ collectible: { rarity: "rare" } }, { collectible: { rarity: "epic" } }]
  }, {
    id: "older", distanceMeters: 600, xpEarned: 10, collectedCount: 1,
    events: [{ collectible: { rarity: "rare" } }]
  }];

  it("derives Home totals from persisted activity history", () => {
    expect(homeViewModel(progress, activities)).toMatchObject({
      progress: { remainingXp: 300 },
      stats: { totalXp: 700, distanceMeters: 6_000, totalCollected: 3, rareFinds: 2 },
      latest: activities[0]
    });
  });

  it("includes a static route preview when the latest activity has replay data", () => {
    const activity = {
      ...activities[0],
      startedAt: "2026-09-26T09:00:00.000Z",
      replay: {
        activity: {
          route: [{ latitude: 48, longitude: 11, timestampMs: 0 }, { latitude: 48.1, longitude: 11.1, timestampMs: 1_000 }]
        },
        activityResult: { collectibles: [], events: [] }
      }
    };

    expect(HomeRecentActivity(activity)).toContain('class="activity-replay-still home-activity-replay"');
    expect(HomeRecentActivity(activity)).toContain("data-replay-still");
    expect(HomeRecentActivity(activity)).not.toContain("activity-replay-play");
    expect(HomeRecentActivity(activity)).toContain('data-activity-id="latest"');
  });
});

describe("Home active quests", () => {
  const quest = (over = {}) => ({
    id: "q1", status: "active", title: "<b>Run</b>", description: "A & B",
    objectives: [{ progress: { complete: true } }, { progress: { complete: false } }], ...over
  });

  it("keeps only active instances", () => {
    expect(activeQuestInstances([quest(), quest({ id: "q2", status: "completed" })]).map((q) => q.id)).toEqual(["q1"]);
  });

  it("renders escaped read-only cards with progress", () => {
    const html = HomeActiveQuestCard(quest());
    expect(html).toContain("&lt;b&gt;Run&lt;/b&gt;");
    expect(html).toContain("A &amp; B");
    expect(html).toContain("1 / 2 objectives");
    expect(html).toContain("width: 50%");
    expect(html).not.toContain("data-quest-cancel");
  });

  it("renders the empty state with a World control", () => {
    const html = HomeActiveQuests([]);
    expect(html).toContain("You don't have any quests active, find some in");
    expect(html).toContain("data-home-find-quests");
  });
});
