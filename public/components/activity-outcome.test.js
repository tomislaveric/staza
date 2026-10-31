import { describe, expect, it } from "vitest";
import { ActivityOutcome, levelStateAt } from "./activity-outcome.js";
import { ActivityProgress } from "./activity-progress.js";
import { replayRewardItems } from "./replay-tab.js";
import { CollectibleCard } from "./collected-list.js";
import { translateAppTextNode } from "../app-locales.js";

const levels = [
  { level: 4, totalXpRequired: 600 },
  { level: 5, totalXpRequired: 1000 },
  { level: 6, totalXpRequired: 1500 },
  { level: 7, totalXpRequired: 2100 }
];

const outcome = (overrides = {}) => ({
  xp: { total: 480, collectibles: 200, flowlines: 50, distance: 30, quests: 200 },
  progression: {
    previousTotalXp: 900, newTotalXp: 1380, previousLevel: 4, newLevel: 5, levelsGained: 1,
    skillPointsEarned: 1, unspentSkillPoints: 1, levels
  },
  unlockableNodes: [{ id: "n1", name: "Rusher I" }],
  collectibles: { newCount: 3, revisitCount: 2 },
  flowlines: { completedCount: 1, newCount: 1 },
  quests: [
    { result: "completed", title: "Warm up", chainTitle: "Chain", difficulty: "easy", xp: 200, next: { title: "Next one", xp: 250 } },
    { result: "failed", title: "Long one", criteria: [{ label: "Distance", current: 12, required: 30, met: false, unit: "km" }] }
  ],
  ...overrides
});

describe("activity outcome", () => {
  it("derives level state from the frozen level table so replay can level up mid-animation", () => {
    expect(levelStateAt(outcome(), 0)).toMatchObject({ level: 4, currentLevelXp: 300, nextLevelXp: 400 });
    expect(levelStateAt(outcome(), 480)).toMatchObject({ level: 5, currentLevelXp: 380, nextLevelXp: 500 });
  });

  it("renders only quest results in the outcome card", () => {
    const html = ActivityOutcome(outcome());
    expect(html).toContain('data-outcome-quest="completed"');
    expect(html).toContain('data-outcome-quest="failed"');
    expect(html).toContain("12 / 30 km");
    expect(html).not.toContain("Now unlockable");
    expect(ActivityOutcome(outcome({ quests: [] }))).toBe("");
    expect(ActivityOutcome(undefined)).toBe("");
  });

  it("merges level-up, facts and the Skill Tree CTA into the XP card", () => {
    const html = ActivityProgress({ replay: { outcome: outcome() } }, {});
    expect(html).toContain("Level 4 \u2192 5");
    expect(html).toContain("2 revisited");
    expect(html).toContain("+1 Skill Point");
    expect(html).toContain("data-outcome-open-atlas");
    expect(html).not.toContain("COLLECTED");
    const spend = ActivityProgress({ replay: { outcome: outcome({ progression: { ...outcome().progression, skillPointsEarned: 0, unspentSkillPoints: 2 } }) } }, {});
    expect(spend).toContain("2 Skill Points to spend");
  });

  it("shows the activity's own XP and level from the outcome, not the current player state", () => {
    const html = ActivityProgress({ xpEarned: 280, collectedCount: 5, replay: { outcome: outcome() } }, { level: 9, currentLevelXp: 1, nextLevelXp: 2, progressToNextLevel: 0.5 });
    expect(html).toContain('data-activity-xp="480"');
    expect(html).toContain("Level 4 \u2192 5");
    expect(html).toContain("3 new collectibles");
    expect(html).not.toContain("Explorer");
  });

  it("labels revisits without XP in replay rewards and the collected list", () => {
    const replay = {
      activity: { startedAt: 0, endedAt: 1000, route: [] },
      activityResult: { events: [{ sourceId: "a", activityTimestamp: 10, value: 0, repeat: true, collectible: { name: "A" } }] }
    };
    expect(replayRewardItems(replay, 0)[0].eventLabel).toBe("REVISITED \u00b7 NO XP");
    expect(CollectibleCard({ sourceId: "a", value: 0, repeat: true, collectible: { name: "A", type: "coin" } })).toContain("Revisited \u00b7 no XP");
  });

  it("translates the new outcome copy to German", () => {
    expect(translateAppTextNode("WHAT CHANGED", "de")).toBe("WAS SICH GEÄNDERT HAT");
    expect(translateAppTextNode("(2 revisited, no XP)", "de")).toBe("(2 erneut besucht, keine XP)");
    expect(translateAppTextNode("Starting", "de")).toBe("Starting");
  });
});
