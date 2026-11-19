import { describe, expect, it } from "vitest";
import {
  HomeAchievements, HomeOnboarding, HomePage, HomeRecentActivity, HomeSkillHighlights, HomeUpNext,
  almostNodes, featuredQuest, homeHighlights, homeViewModel, readyNodes, requirementProgress
} from "./home-page.js";

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

describe("Home highlights", () => {
  const quest = (id, overrides = {}) => ({ id, chainTitle: "Flow", title: `Quest ${id}`, description: "One ride.", difficulty: "medium", xp: 100, state: "active", step: 1, totalSteps: 3, ...overrides });
  const exploration = { id: "e1", status: "active", title: "Lake loop", description: "Collect 3 targets.", rewardXp: 250 };
  const node = (id, overrides = {}) => ({ id, name: `Node ${id}`, sport: "cycling", cost: 1, state: "locked", prerequisitesMet: true, grant: { label: "Unlocks a quest" }, requirements: [], ...overrides });
  const requirement = (current, target, label = "Flowlines") => ({ label, current, target, met: current >= target });

  it("features the easiest active quest by difficulty, then XP, then catalog order", () => {
    expect(featuredQuest([
      quest("hard", { difficulty: "hard", xp: 50 }),
      quest("medium-rich", { xp: 300 }),
      quest("done", { difficulty: "easy", state: "completed" }),
      quest("medium-a"),
      quest("medium-b")
    ]).id).toBe("medium-a");
    expect(featuredQuest([quest("m"), quest("e", { difficulty: "easy", xp: 400 })]).id).toBe("e");
    expect(featuredQuest([quest("x", { state: "locked" })])).toBeUndefined();
  });

  it("lists unlockable nodes cheapest first, capped at three", () => {
    const nodes = [node("a", { state: "unlockable", cost: 3 }), node("b", { state: "unlockable" }), node("c"), node("d", { state: "unlockable", cost: 2 }), node("e", { state: "unlockable", cost: 3 })];
    expect(readyNodes(nodes).map((item) => item.id)).toEqual(["b", "d", "a"]);
  });

  it("ranks started, locked nodes with met prerequisites by requirement progress", () => {
    const nodes = [
      node("half", { requirements: [requirement(5, 10)] }),
      node("untouched", { requirements: [requirement(0, 10)] }),
      node("blocked", { prerequisitesMet: false, requirements: [requirement(9, 10)] }),
      node("premium", { state: "premium_locked", requirements: [requirement(9, 10)] }),
      node("needs-sp", { cost: 3, requirements: [requirement(12, 10)] }),
      node("mixed", { requirements: [requirement(30, 10), requirement(1, 10)] })
    ];
    expect(almostNodes(nodes).map((item) => [item.node.id, item.progress])).toEqual([["needs-sp", 1], ["mixed", 0.55], ["half", 0.5]]);
    expect(requirementProgress(node("free"))).toBe(1);
  });

  it("renders Up next for the featured quest with a link to the other quests and the exploration", () => {
    const highlights = homeHighlights({
      authoredQuests: [quest("1"), quest("2", { difficulty: "easy", title: "<b>Ride</b>", isNew: true }), quest("3", { state: "locked" })],
      instances: [exploration]
    });
    expect(highlights).toMatchObject({ quest: { id: "2" }, activeQuestCount: 2, exploration: { id: "e1" } });
    const html = HomeUpNext(highlights);
    expect(html).toContain('data-home-up-next="quest:2"');
    expect(html).toContain("&lt;b&gt;Ride&lt;/b&gt;");
    expect(html).toContain('<span class="quest-pill is-muted">Step 1/3</span>');
    expect(html).toContain("1 more active quest ");
    expect(html).toContain('data-home-up-next="exploration:e1"');
    expect(html).not.toContain("quest-task-check");
  });

  it("falls back to an exploration, then to planning one", () => {
    expect(HomeUpNext(homeHighlights({ instances: [exploration] }))).toContain('class="home-up-next-card is-exploration" data-home-action-target="world"');
    expect(HomeUpNext(homeHighlights({}))).toContain('data-home-up-next="plan-exploration"');
  });

  it("renders ready and almost nodes as Skill Atlas links with progress", () => {
    const html = HomeSkillHighlights(homeHighlights({
      skillPoints: 2,
      nodes: [node("r", { state: "unlockable", cost: 2, name: "<i>Rusher</i>" }), node("a", { requirements: [requirement(2.5, 10, "Distance km")] }), node("s", { cost: 4, requirements: [requirement(1, 1)] })]
    }));
    expect(html).toContain("2 SP to spend");
    expect(html).toContain('data-home-skill-node="r"');
    expect(html).toContain("&lt;i&gt;Rusher&lt;/i&gt;");
    expect(html).toContain("Unlock · 2 SP");
    expect(html).toContain("<b>2.5/10</b>");
    expect(html).toContain('aria-valuenow="25"');
    expect(html).toContain("Needs 2 more SP");
  });

  it("prompts to spend Skill Points without ready nodes and hides when there is nothing to show", () => {
    expect(HomeSkillHighlights(homeHighlights({ skillPoints: 1 }))).toContain("Spend 1 Skill Point in the Skill Atlas");
    expect(HomeSkillHighlights(homeHighlights({}))).toBe("");
  });

  it("shows Up next and Skill Atlas highlights on Home once there is an activity", () => {
    const model = {
      progress: { totalXp: 0, level: 1, currentLevelXp: 0, nextLevelXp: 100, progressToNextLevel: 0, remainingXp: 100 },
      stats: { totalXp: 0, distanceMeters: 0, totalCollected: 0 },
      latest: { id: "a", startedAt: "2026-11-01T08:00:00.000Z", distanceMeters: 1000, xpEarned: 1, collectedCount: 0, events: [] },
      activeQuests: [],
      achievements: { skillPoints: 0, authoredQuests: [quest("1")], nodes: [node("r", { state: "unlockable" })] }
    };
    const html = HomePage(model);
    expect(html).toContain('data-home-up-next="quest:1"');
    expect(html).toContain("data-home-skill-highlights");
    expect(html).not.toContain("data-home-todos");
    expect(html).not.toContain("data-home-onboarding");
  });

  it("shows onboarding instead of Up next before the first activity", () => {
    const model = { progress: { totalXp: 0, level: 1, currentLevelXp: 0, nextLevelXp: 100, progressToNextLevel: 0, remainingXp: 100 }, stats: { totalXp: 0, distanceMeters: 0, totalCollected: 0 }, latest: undefined, activeQuests: [] };
    const html = HomePage(model);
    expect(html).toContain("data-home-onboarding");
    expect(html).not.toContain("data-home-up-next-section");
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

  it("leaves the Skill Point balance to the Skill Atlas highlights, plus the summary", () => {
    const html = HomeAchievements({ skillPoints: 2, stats: { totalXp: 700, distanceMeters: 6_000, totalCollected: 3 } });
    expect(html).not.toContain("SP to spend");
    expect(html).toContain("Total XP");
  });
});
