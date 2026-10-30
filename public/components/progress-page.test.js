import { describe, expect, it } from "vitest";
import {
  AuthoredQuests,
  ProgressPage,
  ProgressSummary,
  QuestHistory,
  RecentActivities,
  levelName,
  progressViewModel,
  responseJson
} from "./progress-page.js";

const dashboard = {
  progress: {
    totalXp: 4_590,
    level: 7,
    currentLevelXp: 390,
    nextLevelXp: 700,
    progressToNextLevel: 390 / 700,
    remainingXp: 310,
    progressPercent: 55.7
  },
  lifetime: {
    distanceMeters: 1_247_800,
    totalCollectibles: 34,
    totalFlowlines: 3
  },
  sportRecords: [
    { type: "cycling", activityCount: 3, distanceMeters: 900_000, longestDistanceMeters: 120_000, highestElevationGainM: 1_450 },
    { type: "running", activityCount: 1, distanceMeters: 21_000, longestDistanceMeters: 21_000 }
  ],
  milestones: { places: 4, peaks: 2, mountainPasses: 1, flowlines: 3 },
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
    expect(page).toContain("Activity · SAT 26 SEP");
    expect(page).toContain("+540");
    expect(page).toContain("+320");
  });

  it("shows the level once, with no level window", () => {
    const page = ProgressPage(progressViewModel(dashboard));

    expect(page.match(/Level 7/gi)).toHaveLength(1);
    expect(page).not.toContain("progress-journey");
    expect(page).not.toContain("Level 5");
    expect(levelName(15)).toBe("Level 15");
  });

  it("renders a new player's backend-provided percentage", () => {
    const model = progressViewModel({
      ...dashboard,
      progress: { totalXp: 0, level: 1, currentLevelXp: 0, nextLevelXp: 100, progressToNextLevel: 0, remainingXp: 100, progressPercent: 0 },
      sportRecords: [],
      recentActivities: []
    });

    expect(model.progress.percentage).toBe(0);
    expect(ProgressPage(model)).toContain("NO COMPLETED ACTIVITIES YET");
    expect(ProgressPage(model)).toContain("NO BADGES OR TITLES YET");
    expect(ProgressPage(model)).toContain("IMPORT AN ACTIVITY TO SET YOUR FIRST RECORD");
  });

  it("renders badges, titles, per-sport records and discovery milestones", () => {
    const page = ProgressPage({
      ...progressViewModel(dashboard),
      capabilities: { badges: [{ id: "b", label: "Ultra <Cyclist>" }], titles: [{ id: "t", label: "World Seeker" }] }
    });

    expect(page).toContain("Ultra &lt;Cyclist&gt;");
    expect(page).toContain("World Seeker");
    expect(page).toContain('data-sport-record="cycling"');
    expect(page).toContain("900 km");
    expect(page).toContain("120 km");
    expect(page).toContain("1,450 m");
    expect(page.match(/Highest elevation gain/g)).toHaveLength(1);
    expect(page).toContain("<dt>Mountain passes</dt><dd>1</dd>");
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
    expect(html).toContain('class="authored-quest-state">Available</span>');
    expect(html).toContain("Active · your next activity decides");
    expect(html).toContain('data-start-quest="q:6">Retry<');
    expect(html).toContain("12 / 30 km");
    expect(html).toContain("Easy</span> · +60 XP");
  });

  it("accepts no-content responses when starting a quest", async () => {
    const response = { status: 204, ok: true, json: () => { throw new Error("No response body"); } };
    await expect(responseJson(response)).resolves.toBeUndefined();
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
