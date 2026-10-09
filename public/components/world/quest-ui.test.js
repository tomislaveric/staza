import { describe, expect, it } from "vitest";
import { INITIAL_VISIBLE_QUEST_SUGGESTIONS, QuestList } from "./quest-list.js";
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
      progress: { completed: 1, required: 3, complete: false },
      targetProgress: suggestion().objectives[0].targets.map((target, index) => ({
        ...target,
        complete: index === 0
      }))
    },
    {
      objective: suggestion().objectives[1],
      progress: { completed: 2, required: 3, complete: false },
      targetProgress: suggestion().objectives[1].targets.map((target, index) => ({
        ...target,
        complete: index < 2,
        ...(index < 2 ? { averageSpeedMps: 9.1667 } : {})
      }))
    }
  ],
  ...overrides
});

describe("Quest suggestions and instances", () => {
  it("renders bbox suggestions without tracked progress and offers explicit Start", () => {
    const markup = QuestList([suggestion()], [], undefined);
    expect(markup).toContain("Local recommendations");
    expect(markup).toContain("Optional challenges for exploring places and completing Flowlines.");
    expect(markup).toContain("data-quest-start=\"suggestion-1\"");
    expect(markup).toContain("Start quest");
    expect(markup).toContain("quest-suggestion-goals");
    expect(markup).toContain("Flowline");
    expect(markup).toContain("Place");
    expect(markup.match(/class="quest-suggestion-goal"/g)).toHaveLength(2);
    expect(markup).toContain('<b class="fartlek-swatch" aria-hidden="true"></b>');
    expect(markup).not.toContain("Visit Castle, Bridge, Tower");
    expect(markup).not.toContain("Complete 3 Flowlines");
    expect(markup).not.toContain("Level 2");
    expect(markup).not.toContain("0 / 2 objectives");
  });

  it("collapses recommendations after the first three and renders an accessible disclosure", () => {
    const suggestions = Array.from({ length: 5 }, (_value, index) =>
      suggestion({ id: `suggestion-${index + 1}` })
    );
    const collapsed = QuestList(suggestions, [], undefined);
    expect(collapsed.match(/data-quest-start=/g)).toHaveLength(INITIAL_VISIBLE_QUEST_SUGGESTIONS);
    expect(collapsed).toContain('aria-controls="quest-recommendations" aria-expanded="false"');
    expect(collapsed).toContain("Show all 5 quests");
    expect(collapsed).not.toContain('data-quest-start="suggestion-4"');

    const expanded = QuestList(suggestions, [], undefined, true);
    expect(expanded.match(/data-quest-start=/g)).toHaveLength(suggestions.length);
    expect(expanded).toContain('aria-controls="quest-recommendations" aria-expanded="true"');
    expect(expanded).toContain("Show fewer");
  });

  it("separates persistent active progress from ephemeral recommendations", () => {
    const markup = QuestList([suggestion()], [instance()], undefined);
    expect(markup).toContain("Your running Quests");
    expect(markup).toContain('aria-label="Your running quests"');
    expect(markup).not.toContain(">Active</small>");
    expect(markup).toContain("1 / 3");
    expect(markup).toContain("2/3");
    expect(markup).toContain('<b class="fartlek-swatch" aria-hidden="true"></b>');
    expect(markup).toContain("Castle");
    expect(markup).toContain("One - 33 km/h");
    expect(markup).toContain("Two - 33 km/h");
    expect(markup).not.toContain("Three");
    expect(markup).toContain("1 / 3");
    expect(markup).toContain("Complete");
    expect(markup).toContain("Not complete");
    expect(markup).toContain("Flowlines completed");
    expect(markup).toContain('<b class="fartlek-swatch is-completed" aria-hidden="true"></b>');
    expect(markup).toContain("Started");
    expect(markup).toContain("disabled");
    expect(markup).toContain('aria-label="Cancel quest"');
    expect(markup).toContain('title="Cancel quest"');
    expect(markup).toContain(">✕</button>");
  });

  it("does not offer cancellation for completed quests", () => {
    const markup = QuestList([], [instance({ status: "completed" })], undefined);
    expect(markup).toContain("Complete");
    expect(markup).not.toContain("data-quest-cancel=");
    expect(markup).not.toContain("One - 33 km/h");
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
    expect(markup).not.toContain("data-quest-cancel=");
  });

  it("renders useful empty states without fabricating quests", () => {
    const markup = QuestList([], [], undefined);
    expect(markup).toContain("No curated quests match this map area yet.");
    expect(markup).toContain("Start a local recommendation to begin tracking a quest.");
  });

  it("shows per-target Mountain Pass progress on started quests", () => {
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
    const objective = mountainPassQuest.objectives[0];
    const markup = QuestList([], [instance({
      objectives: [{
        objective,
        progress: { completed: 1, required: 3, complete: false },
        targetProgress: objective.targets.map((target, index) => ({
          ...target,
          complete: index === 0
        }))
      }]
    })], undefined);
    expect(markup).toContain("mountain passes");
    expect(markup).toContain("Pass One");
    expect(markup).toContain("Pass Two");
    expect(markup).toContain('<b class="collectible-swatch is-unvisited is-common is-mountain_pass is-icon" aria-hidden="true">\u26f0</b>');
  });

  it("renders inline Mountain Pass and peak goal chips on recommendations", () => {
    const recommendation = suggestion({
      objectives: [
        { id: "passes", type: "collectible_count", requiredCount: 3, category: "mountain_pass", targets: [] },
        { id: "peaks", type: "collectible_count", requiredCount: 3, category: "peak", targets: [] }
      ]
    });
    const markup = QuestList([recommendation], [], undefined);
    expect(markup).toContain("Mountain pass");
    expect(markup).toContain("Mountain peak");
    expect(markup).toContain('<b class="collectible-swatch is-unvisited is-common is-mountain_pass is-icon" aria-hidden="true">\u26f0</b>');
    expect(markup).toContain('<b class="collectible-swatch is-unvisited is-common is-peak is-icon" aria-hidden="true">\u25b2</b>');
    expect(markup.match(/class="quest-suggestion-goal"/g)).toHaveLength(2);
  });

  it("shows mixed active objectives but lists only completed Flowlines with speed", () => {
    const flowline = {
      id: "flowlines",
      type: "flowline_rule",
      requiredCount: 1,
      targets: [{ id: "f1", name: "River Line" }]
    };
    const mountainPass = {
      id: "passes",
      type: "collectible_count",
      requiredCount: 1,
      category: "mountain_pass",
      targets: [{ id: "p1", name: "North Pass" }]
    };
    const finalFlowline = {
      id: "final-flowline",
      type: "flowline_rule",
      requiredCount: 1,
      minimumLengthMeters: 2000,
      targets: [{ id: "f2", name: "Forest Line" }]
    };
    const active = instance({
      objectives: [flowline, mountainPass, finalFlowline].map((objective, index) => ({
        objective,
        progress: { completed: index === 2 ? 0 : 1, required: 1, complete: index !== 2 },
        targetProgress: objective.targets.map((target) => ({
          ...target,
          complete: index !== 2,
          ...(objective.type === "flowline_rule" && index === 0 ? { averageSpeedMps: 4.1667 } : {})
        }))
      }))
    });

    const markup = QuestList([], [active], undefined);
    expect(markup).toContain("Flowlines completed");
    expect(markup).toContain("River Line - 15 km/h");
    expect(markup).not.toContain("Forest Line");
    expect(markup).toContain("North Pass");
    expect(markup.match(/class="quest-objective-group"/g)).toHaveLength(3);
    expect(markup).toContain('<b class="fartlek-swatch" aria-hidden="true"></b>');
    expect(markup).toContain('<b class="fartlek-swatch is-completed" aria-hidden="true"></b>');
    expect(markup).toContain("1 / 1");
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
