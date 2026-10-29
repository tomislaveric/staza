import { describe, expect, it } from "vitest";
import { HomeAchievements, HomeNextAction, HomeOnboarding, HomePage, HomeRecentActivity, homeNextAction, homeViewModel } from "./home-page.js";

describe("Home data transformation", () => {
  const progress = { totalXp: 700, level: 4, currentLevelXp: 100, nextLevelXp: 400, progressToNextLevel: .25 };
  const activities = [{
    id: "latest", distanceMeters: 5_400, durationSeconds: 1200, xpEarned: 40, collectedCount: 2,
    events: [{ collectible: { name: "Viewpoint" } }, { collectible: { name: "Castle" } }]
  }, {
    id: "older", distanceMeters: 600, xpEarned: 10, collectedCount: 1,
    events: [{ collectible: { name: "Peak" } }]
  }];

  it("derives Home totals from persisted activity history", () => {
    expect(homeViewModel(progress, activities)).toMatchObject({
      progress: { remainingXp: 300 },
      stats: { totalXp: 700, distanceMeters: 6_000, totalCollected: 3 },
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

describe("Home next action", () => {
  it("prioritises Skill Points, failed, active, available quests, then exploration", () => {
    const quest = (state) => ({ title: "Q", chainTitle: "C", xp: 100, state });
    expect(homeNextAction({ skillPoints: 2, authoredQuests: [quest("failed")] }).id).toBe("spend-skill-points");
    expect(homeNextAction({ authoredQuests: [quest("available"), quest("failed")] }).id).toBe("retry-quest");
    expect(homeNextAction({ authoredQuests: [quest("active")] }).id).toBe("active-quest");
    expect(homeNextAction({ authoredQuests: [quest("available")] }).id).toBe("start-quest");
    expect(homeNextAction({ instances: [{ status: "active", title: "E" }] })).toMatchObject({ id: "active-exploration", target: "world" });
    expect(homeNextAction({}).target).toBe("world");
    expect(HomeNextAction(homeNextAction({ skillPoints: 1 }))).toContain('data-home-action-target="skill-tree"');
  });

  it("shows onboarding instead of a next action before the first activity", () => {
    const model = { progress: { totalXp: 0, level: 1, currentLevelXp: 0, nextLevelXp: 100, progressToNextLevel: 0, remainingXp: 100 }, stats: { totalXp: 0, distanceMeters: 0, totalCollected: 0 }, latest: undefined, activeQuests: [] };
    const html = HomePage(model);
    expect(html).toContain("data-home-onboarding");
    expect(html).not.toContain("data-home-next-action");
    expect(HomeOnboarding()).toContain('data-home-action-target="add-activity"');
    expect(html).not.toContain("EXPLORER");
  });
});

describe("Home achievements", () => {
  it("shows unlocked skills, badges and the next authored quest", () => {
    const html = HomeAchievements({
      skillPoints: 2, totalNodes: 79, unlocked: [{ id: "endurance-i", name: "Endurance I" }],
      badges: [{ id: "b", label: "Trailblazer" }],
      nextQuest: { chainTitle: "Distance", step: 1, totalSteps: 3, title: "Ride 30 km", description: "One ride.", xp: 90 }
    });
    expect(html).toContain("<em> / 79</em>");
    expect(html).toContain("Trailblazer");
    expect(html).toContain("Ride 30 km");
  });

  it("shows Skill Points only when there are some to spend, plus the summary", () => {
    expect(HomeAchievements({ skillPoints: 0 })).not.toContain("SP to spend");
    const html = HomeAchievements({ skillPoints: 2, stats: { totalXp: 700, distanceMeters: 6_000, totalCollected: 3 } });
    expect(html).toContain("2 SP to spend");
    expect(html).toContain("Total XP");
  });
});
