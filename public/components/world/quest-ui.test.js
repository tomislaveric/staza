import { describe, expect, it } from "vitest";
import { QuestList } from "./quest-list.js";
import { markerLabel } from "./world-markers.js";
import { CollectibleSwatch } from "./collectible-swatch.js";

const suggestion = (overrides = {}) => ({
  id: "suggestion-1",
  templateId: "local-explorer",
  templateVersion: 1,
  title: "Local Explorer",
  description: "Visit local places and ride Flowlines.",
  recommendedLevel: 2,
  objectives: [
    {
      id: "places",
      type: "collectible_targets",
      requiredCount: 3,
      category: "place",
      targets: [
        { id: "a", name: "Castle" },
        { id: "b", name: "Bridge" },
        { id: "c", name: "Tower" }
      ]
    },
    {
      id: "flowlines",
      type: "flowline_rule",
      requiredCount: 3,
      minimumLengthMeters: 2000,
      minimumAverageSpeedMps: 8.3333,
      targets: [{ id: "f1", name: "One" }, { id: "f2", name: "Two" }, { id: "f3", name: "Three" }]
    }
  ],
  ...overrides
});

const instance = (overrides = {}) => ({
  id: "instance-1",
  suggestionId: "suggestion-1",
  templateId: "local-explorer",
  templateVersion: 1,
  title: "Local Explorer",
  description: "Visit local places and ride Flowlines.",
  recommendedLevel: 2,
  status: "active",
  startedAt: "2026-04-01T10:00:00.000Z",
  objectives: [
    {
      objective: suggestion().objectives[0],
      progress: { completed: 1, required: 3, complete: false }
    },
    {
      objective: suggestion().objectives[1],
      progress: { completed: 2, required: 3, complete: false }
    }
  ],
  ...overrides
});

describe("Quest suggestions and instances", () => {
  it("renders bbox suggestions without tracked progress and offers explicit Start", () => {
    const markup = QuestList([suggestion()], [], undefined);
    expect(markup).toContain("Local recommendations");
    expect(markup).toContain("data-quest-start=\"suggestion-1\"");
    expect(markup).toContain("Start quest");
    expect(markup).toContain("Visit Castle, Bridge, Tower");
    expect(markup).toContain("Complete 3 Flowlines");
    expect(markup).toContain("Level 2");
    expect(markup).not.toContain("0 / 2 objectives");
  });

  it("separates persistent active progress from ephemeral recommendations", () => {
    const markup = QuestList([suggestion()], [instance()], undefined);
    expect(markup).toContain("Your quests");
    expect(markup).toContain("Active");
    expect(markup).toContain("1 / 3");
    expect(markup).toContain("2 / 3");
    expect(markup).toContain("Started");
    expect(markup).toContain("disabled");
    expect(markup).toContain("Cancel quest");
  });

  it("does not offer cancellation for completed quests", () => {
    const markup = QuestList([], [instance({ status: "completed" })], undefined);
    expect(markup).toContain("Complete");
    expect(markup).not.toContain("Cancel quest");
  });

  it("shows completed instance status and escapes quest-controlled content", () => {
    const markup = QuestList([], [instance({
      title: "<script>",
      status: "completed",
      objectives: instance().objectives.map((item) => ({
        ...item,
        progress: { ...item.progress, complete: true, completed: item.progress.required }
      }))
    })], undefined);
    expect(markup).toContain("Complete");
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("Cancel quest");
  });

  it("renders useful empty states without fabricating quests", () => {
    const markup = QuestList([], [], undefined);
    expect(markup).toContain("No curated quests match this map area yet.");
    expect(markup).toContain("Start a local recommendation to begin tracking a quest.");
  });

  it("labels Mountain Pass objectives in recommendations", () => {
    const mountainPassQuest = suggestion({
      objectives: [{
        id: "passes",
        type: "collectible_count",
        requiredCount: 3,
        category: "mountain_pass",
        targets: [
          { id: "pass-1", name: "Pass One" },
          { id: "pass-2", name: "Pass Two" },
          { id: "pass-3", name: "Pass Three" }
        ]
      }]
    });
    expect(QuestList([mountainPassQuest], [], undefined)).toContain("Discover 3 mountain passes");
  });
});

describe("world marker vocabulary", () => {
  it("labels collectibles with visited state for assistive technology", () => {
    expect(markerLabel({ name: "Turmberg", found: true, rarity: "epic" })).toBe("Turmberg, visited, epic");
    expect(markerLabel({ name: "Turmberg", found: false })).toBe("Turmberg, unvisited");
  });

  it("encodes discovery and rarity in one swatch", () => {
    expect(CollectibleSwatch({ visited: true })).toContain("is-visited");
    expect(CollectibleSwatch({ visited: false })).toContain("is-unvisited");
    expect(CollectibleSwatch({ rarity: "epic" })).toContain("is-epic");
    expect(CollectibleSwatch({ rarity: "rare" })).toContain("is-rare");
    expect(CollectibleSwatch({ category: "castle" })).toContain("is-castle");
    expect(CollectibleSwatch()).toContain("is-common");
  });
});
