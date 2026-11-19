import { describe, expect, it } from "vitest";
import { HomeAchievements, HomeOnboarding, HomePage, HomeRecentActivity, HomeTodos, homeTodos, homeViewModel } from "./home-page.js";

describe("Home data transformation", () => {
  const progress = { totalXp: 700, level: 4, currentLevelXp: 100, nextLevelXp: 400, progressToNextLevel: .25 };
  const activities = [{
    id: "latest", distanceMeters: 5_400, durationSeconds: 1200, xpEarned: 40, collectedCount: 2,
    events: [{ collectible: { name: "Viewpoint" } }, { collectible: { name: "Castle" } }]
  }, {
    id: "older", distanceMeters: 600, xpEarned: 10, collectedCount: 1,
    events: [{ collectible: { name: "Peak" } }]
  }];

  it("maps backend lifetime totals onto Home stats", () => {
    const lifetime = { distanceMeters: 6_000, totalCollectibles: 3, totalFlowlines: 1 };
    expect(homeViewModel({ ...progress, remainingXp: 300 }, activities, lifetime)).toMatchObject({
      progress: { remainingXp: 300 },
      stats: { totalXp: 700, distanceMeters: 6_000, totalCollected: 3, totalFlowlines: 1 },
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

describe("Home to-do list", () => {
  const quest = (id, state = "active") => ({ id, title: `Quest ${id}`, description: "One ride.", difficulty: "easy", xp: 100, state });
  const exploration = { id: "e1", status: "active", title: "Lake loop", description: "Collect 3 targets.", rewardXp: 250 };

  it("orders Skill Points, capped active quests, explorations, and hides the fallback", () => {
    const quests = [quest("1"), quest("2", "locked"), quest("3"), quest("4"), quest("5")];
    const todos = homeTodos({ skillPoints: 2, authoredQuests: quests, instances: [exploration, { ...exploration, id: "e2", status: "completed" }] });
    expect(todos.map((todo) => todo.id)).toEqual(["spend-skill-points", "quest:1", "quest:3", "quest:4", "view-all-quests", "exploration:e1"]);
    expect(todos[0]).toMatchObject({ title: "Spend 2 Skill Points", target: "skill-tree" });
    expect(todos[4]).toMatchObject({ title: "View all quests (4)", target: "progress" });
    expect(homeTodos({ skillPoints: 1 })[0].title).toBe("Spend 1 Skill Point");
  });

  it("falls back to planning an exploration only when nothing is active", () => {
    expect(homeTodos({}).map((todo) => todo.id)).toEqual(["plan-exploration"]);
    expect(homeTodos({ authoredQuests: [quest("1")] }).map((todo) => todo.id)).toEqual(["quest:1"]);
    expect(homeTodos({ instances: [exploration] }).map((todo) => todo.id)).toEqual(["exploration:e1"]);
  });

  it("renders every to-do as a navigation button with a chevron and escapes content", () => {
    const html = HomeTodos(homeTodos({
      skillPoints: 1,
      authoredQuests: [{ ...quest("1"), title: "<b>Ride</b>" }],
      instances: [{ ...exploration, description: "<img>" }]
    }));
    expect(html).toContain("data-home-todos");
    expect(html).toContain('<span class="quest-pill is-accent">1 SP</span>');
    expect(html).toContain('data-home-action-target="skill-tree"');
    expect(html).toContain('class="quest-task is-action authored-quest is-active" data-home-action-target="progress" data-authored-quest="1"');
    expect(html).toContain('data-home-action-target="world" data-home-todo="exploration:e1"');
    expect(html).toContain('<span class="quest-pill is-muted">Exploration</span><span class="quest-pill is-accent">+250 XP</span>');
    expect(html).toContain("&lt;b&gt;Ride&lt;/b&gt;");
    expect(html).not.toContain("<img>");
    expect(html.match(/class="quest-task-chevron"/g)).toHaveLength(3);
  });

  it("replaces the NEXT card on Home once there is an activity", () => {
    const model = {
      progress: { totalXp: 0, level: 1, currentLevelXp: 0, nextLevelXp: 100, progressToNextLevel: 0, remainingXp: 100 },
      stats: { totalXp: 0, distanceMeters: 0, totalCollected: 0 },
      latest: { id: "a", startedAt: "2026-11-01T08:00:00.000Z", distanceMeters: 1000, xpEarned: 1, collectedCount: 0, events: [] },
      activeQuests: [],
      achievements: { skillPoints: 0, authoredQuests: [quest("1")] }
    };
    const html = HomePage(model);
    expect(html).toContain("data-home-todos");
    expect(html).not.toContain("home-next-action\"");
    expect(html).not.toContain("NEXT QUEST");
    expect(html).not.toContain("data-home-onboarding");
  });

  it("shows onboarding instead of a next action before the first activity", () => {
    const model = { progress: { totalXp: 0, level: 1, currentLevelXp: 0, nextLevelXp: 100, progressToNextLevel: 0, remainingXp: 100 }, stats: { totalXp: 0, distanceMeters: 0, totalCollected: 0 }, latest: undefined, activeQuests: [] };
    const html = HomePage(model);
    expect(html).toContain("data-home-onboarding");
    expect(html).not.toContain("data-home-todos");
    expect(HomeOnboarding()).toContain('data-home-action-target="add-activity"');
    expect(html).not.toContain("EXPLORER");
  });
});

describe("Home achievements", () => {
  it("shows unlocked skills and badges without a separate next quest card", () => {
    const html = HomeAchievements({
      skillPoints: 2, totalNodes: 79, unlocked: [{ id: "endurance-i", name: "Endurance I" }],
      badges: [{ id: "b", label: "Trailblazer" }]
    });
    expect(html).toContain("<em> / 79</em>");
    expect(html).toContain("Trailblazer");
    expect(html).not.toContain("NEXT QUEST");
  });

  it("shows Skill Points only when there are some to spend, plus the summary", () => {
    expect(HomeAchievements({ skillPoints: 0 })).not.toContain("SP to spend");
    const html = HomeAchievements({ skillPoints: 2, stats: { totalXp: 700, distanceMeters: 6_000, totalCollected: 3 } });
    expect(html).toContain("2 SP to spend");
    expect(html).toContain("Total XP");
  });
});
