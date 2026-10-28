import { describe, expect, it } from "vitest";
import {
  AuthoredQuests,
  ProgressPage,
  ProgressSummary,
  QuestHistory,
  RecentActivities,
  levelName,
  progressViewModel
} from "./progress-page.js";

const dashboard = {
  progress: {
    totalXp: 4_590,
    level: 7,
    currentLevelXp: 390,
    nextLevelXp: 700,
    progressToNextLevel: 390 / 700
  },
  lifetime: {
    distanceMeters: 1_247_800,
    totalCollectibles: 34,
    totalFlowlines: 3
  },
  levels: [
    { level: 5, skillPointsAwarded: 1, totalXpRequired: 1_000 },
    { level: 6, skillPointsAwarded: 0, totalXpRequired: 1_500 },
    { level: 7, skillPointsAwarded: 0, totalXpRequired: 2_100 },
    { level: 8, skillPointsAwarded: 1, totalXpRequired: 2_800 },
    { level: 9, skillPointsAwarded: 0, totalXpRequired: 3_600 },
    { level: 10, skillPointsAwarded: 0, totalXpRequired: 4_500 }
  ],
  recentActivities: [{
    id: "latest",
    startedAt: "2026-09-26T09:00:00.000Z",
    distanceMeters: 66_800,
    collectedCount: 5,
    xpEarned: 540
  }, {
    id: "older",
    startedAt: "2026-09-23T09:00:00.000Z",
    distanceMeters: 44_200,
    collectedCount: 2,
    xpEarned: 320
  }]
};

describe("Progress page", () => {
  it("renders canonical progress values and uses persisted recent-activity XP", () => {
    const page = ProgressPage(progressViewModel(dashboard));

    expect(page).toContain("4,590 XP");
    expect(page).toContain("1,247.8 km covered");
    expect(page).toContain("390 XP");
    expect(page).toContain("310 to Level 8");
    expect(page).toContain('aria-valuemax="700"');
    expect(page).toContain('aria-valuenow="390"');
    expect(page).toContain("2,800 XP needed");
    expect(page).toContain("Activity · SAT 26 SEP");
    expect(page).toContain("+540");
    expect(page).toContain("+320");
  });

  it("derives completed, current, and future level states from canonical player level", () => {
    const model = progressViewModel(dashboard);

    expect(model.levels.map((level) => level.state)).toEqual([
      "completed", "completed", "current", "future", "future", "future"
    ]);
    expect(ProgressPage(model)).toContain("CURRENT");
    expect(ProgressPage(model)).toContain("COMPLETE");
    expect(levelName(7)).toBe("Level 7");
    expect(levelName(15)).toBe("Level 15");
  });

  it("clamps the visual percentage and renders a valid new-player journey", () => {
    const model = progressViewModel({
      ...dashboard,
      progress: {
        totalXp: 0,
        level: 1,
        currentLevelXp: 0,
        nextLevelXp: 100,
        progressToNextLevel: -1
      },
      levels: [
        { level: 1, totalXpRequired: 0 },
        { level: 2, totalXpRequired: 100 },
        { level: 3, totalXpRequired: 300 },
        { level: 4, totalXpRequired: 600 }
      ],
      recentActivities: []
    });

    expect(model.progress.percentage).toBe(0);
    expect(model.levels.map((level) => level.state)).toEqual(["current", "future", "future", "future"]);
    expect(ProgressPage(model)).toContain("NO COMPLETED ACTIVITIES YET");
    expect(ProgressPage(model)).not.toContain("is-completed");
  });

  it("explains Skill Points and marks only awarding levels", () => {
    const page = ProgressPage(progressViewModel(dashboard));

    expect(page).toContain("earn Skill Points you can spend in the Skill Atlas");
    expect(page.match(/\+1 Skill Point/g)).toHaveLength(2);
  });

  it("renders no activity history safely", () => {
    expect(RecentActivities([])).toContain("NO COMPLETED ACTIVITIES YET");
  });
});

describe("Authored quests on Progress", () => {
  const quest = (overrides) => ({ id: "q:1", title: "Quest I", description: "Do it.", xp: 60, difficulty: "easy", state: "available", ...overrides });

  it("lists available quests and shows the required node for locked ones", () => {
    const html = AuthoredQuests([
      quest(),
      quest({ id: "q:2", title: "Locked <b>", state: "locked", requiredNode: { id: "n", name: "Rusher I", premium: true } }),
      quest({ id: "q:3", state: "locked", requiredQuestTitle: "Quest I" }),
      quest({ id: "q:4", state: "completed" })
    ]);
    expect(html).toContain('data-authored-quest="q:1"');
    expect(html).toContain("+60 XP");
    expect(html).toContain("Unlock Rusher I in the Skill Atlas (PRO)");
    expect(html).toContain("Complete Quest I first");
    expect(html).toContain("1 completed");
    expect(html).not.toContain("<b>");
  });

  it("offers Start, active copy and Retry with the missed criteria", () => {
    const html = AuthoredQuests([
      quest(),
      quest({ id: "q:5", state: "active", attempt: { status: "active", attemptCount: 1, startedAt: "2026-01-01T00:00:00Z" } }),
      quest({ id: "q:6", state: "failed", attempt: { status: "failed", attemptCount: 1, startedAt: "x", criteria: [{ label: "Distance", current: 12, required: 30, met: false, unit: "km" }] } })
    ]);
    expect(html).toContain('data-start-quest="q:1">Start<');
    expect(html).toContain("Active · your next activity decides");
    expect(html).toContain('data-start-quest="q:6">Retry<');
    expect(html).toContain("12 / 30 km");
    expect(html).toContain("Easy</span> · +60 XP");
  });

  it("lists completed quest history and unique Flowline counts", () => {
    expect(QuestHistory([{ id: "a:1", kind: "authored", title: "Done quest", chainTitle: "Chain", difficulty: "hard", xp: 500, completedAt: "2026-09-26T09:00:00.000Z" }]))
      .toContain("+500 XP");
    expect(QuestHistory([])).toBe("");
    expect(ProgressSummary(progressViewModel(dashboard))).toContain("3 Flowlines");
  });

  it("points to the Skill Atlas when nothing is available", () => {
    expect(AuthoredQuests([])).toContain("Unlock quest nodes in the Skill Atlas");
  });
});
