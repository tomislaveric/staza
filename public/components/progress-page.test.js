import { describe, expect, it } from "vitest";
import {
  AuthoredQuests,
  QuestBadges,
  ProgressPage,
  ProgressSummary,
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

  it("renders active quests as pills and locked quests as one-line rows with a lock pill", () => {
    const html = AuthoredQuests([
      quest({ state: "active", step: 1, totalSteps: 3, description: "Ride <far>." }),
      quest({ id: "q:2", title: "Locked <b>", state: "locked", requiredNode: { id: "n", name: "Rusher I", premium: true } }),
      quest({ id: "q:3", state: "locked", requiredQuestTitle: "Quest I" }),
      quest({ id: "q:4", state: "completed" })
    ]);
    expect(html).toContain('data-authored-quest="q:1"');
    expect(html).toContain('<span class="quest-pill is-muted">Easy</span>');
    expect(html).toContain('<span class="quest-pill is-accent">+60 XP</span>');
    expect(html).toContain('<span class="quest-pill is-muted">Step 1/3</span>');
    expect(html).toContain('title="Ride &lt;far&gt;."');
    expect(html).toContain("Locked quests (2)");
    expect(html).toContain('data-authored-quest="q:2"');
    expect(html).toContain("🔒 Rusher I · PRO</span>");
    expect(html).toContain("After Quest I</span>");
    expect(html).toContain("Locked &lt;b&gt;");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain('data-authored-quest="q:4"');
    expect(html).not.toContain("1 completed");
    expect(html).not.toContain("authored-quests-rule");
    expect(html).not.toContain("Unlocked quests are active right away");
  });

  it("omits the step pill without step data and the PRO marker for free nodes", () => {
    const html = AuthoredQuests([
      quest({ state: "active" }),
      quest({ id: "q:2", state: "locked", requiredNode: { id: "n", name: "Rusher I", premium: false } })
    ]);
    expect(html).not.toContain("Step ");
    expect(html).toContain("🔒 Rusher I</span>");
    expect(html).not.toContain("PRO");
  });

  it("lists only finished quests as completed rows without checkboxes", () => {
    const html = QuestBadges([
      quest({ title: "Flow Quest I", description: "Complete 1 Flowline.", state: "completed", isNew: true }),
      quest({ id: "q:2", title: "Flow Quest II", state: "locked" })
    ]);
    expect(html).toContain("FINISHED QUESTS");
    expect(html).toContain('quest-task authored-quest is-completed is-new" data-authored-quest="q:1"');
    expect(html).toContain("Complete 1 Flowline.");
    expect(html).toContain('<span class="quest-pill is-success">Completed</span>');
    expect(html).not.toContain("quest-task-check");
    expect(html).not.toContain("Flow Quest II");
    expect(QuestBadges([quest({ state: "active" })])).toBe("");
  });

  it("has no Start or Retry control, shows the last failure and flags new quests", () => {
    const html = AuthoredQuests([
      quest({ state: "active", isNew: true }),
      quest({ id: "q:6", state: "active", lastFailure: { attemptCount: 1, failedAt: "x", criteria: [
        { label: "Distance <total>", current: 12, required: 30, met: false, unit: "km" },
        { label: "Elevation", current: 5, required: 5, met: true }
      ] } })
    ]);
    expect(html).not.toContain("data-start-quest");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("your next activity decides");
    expect(html).toContain('authored-quest is-active is-new"');
    expect(html).toContain('<span class="quest-pill is-new">NEW</span>');
    expect(html).toContain('<span class="quest-pill is-danger">Fell short</span>');
    expect(html).toContain('title="Distance &lt;total&gt;">12/30 km</span>');
    expect(html).not.toContain("5/5");
    expect(html).not.toContain("Elevation");
    expect(html).not.toContain("authored-quest-criteria");
  });

  it("accepts no-content responses when starting a quest", async () => {
    const response = { status: 204, ok: true, json: () => { throw new Error("No response body"); } };
    await expect(responseJson(response)).resolves.toBeUndefined();
  });

  it("shows finished quests only as badges, not as a history list, and unique Flowline counts", () => {
    const page = ProgressPage({
      ...progressViewModel(dashboard),
      authoredQuests: [quest({ state: "completed", isNew: true })],
      questHistory: [{ id: "a:1", kind: "authored", title: "Done quest", difficulty: "hard", xp: 500, completedAt: "2026-09-26T09:00:00.000Z" }]
    });
    expect(page).not.toContain("COMPLETED QUESTS");
    expect(page).not.toContain("Done quest");
    expect(page.match(/Quest I/g)).toHaveLength(1);
    expect(ProgressSummary(progressViewModel(dashboard))).toContain("3 Flowlines");
  });

  it("shows no hint when there are no quests", () => {
    expect(AuthoredQuests([])).not.toContain("Unlock quest nodes");
  });
});
