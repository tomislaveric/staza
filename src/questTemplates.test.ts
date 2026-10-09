import { describe, expect, it } from "vitest";
import type { QuestObjective, QuestTemplate, WorldCollectible, WorldFartlek } from "./domain.js";
import { evaluateQuestObjectives, generateQuestSuggestions, validateQuestTemplate } from "./questTemplates.js";
import {
  historyFromQuestStart,
  readQuestTemplateRows
} from "./persistence/questInstanceRepository.js";

const template = (objectives: QuestTemplate["objectives"], overrides: Partial<QuestTemplate> = {}): QuestTemplate => ({
  id: "test-template",
  version: 1,
  title: "Local challenge",
  description: "Complete a local challenge.",
  recommendedLevel: 1,
  objectives,
  ...overrides
});

const collectible = (id: string, primaryCategory: WorldCollectible["primaryCategory"] = "place"): WorldCollectible => ({
  id,
  name: `Place ${id}`,
  type: primaryCategory === "mountain_pass" ? "mountain_pass" : "landmark",
  latitude: 49,
  longitude: 8,
  radiusMeters: 100,
  value: 10,
  primaryCategory,
  found: false,
  visibility: "visible"
});

const flowline = (id: string, lengthMeters = 2500): WorldFartlek => ({
  id,
  name: `Flowline ${id}`,
  geometry: { type: "LineString", coordinates: [[8, 49], [8.1, 49.1]] },
  lengthMeters,
  status: "published",
  source: { sourceType: "test", sourceExternalId: id },
  completed: false,
  completionCount: 0
});

describe("curated quest templates", () => {
  it("validates all curated templates from the seed fixture", async () => {
    const templates = await readQuestTemplateRows("fixtures/quest-templates.json");
    expect(templates).toHaveLength(9);
    expect(templates.map((item) => item.id)).toContain("first-steps");
    expect(templates.map((item) => item.id)).toContain("mountain-pass-discoveries");
    expect(templates.map((item) => item.id)).toContain("mountain-passes-and-flowlines");
  });

  it("requires multiple Flowlines and prevents a standalone single collectible quest", () => {
    expect(() => validateQuestTemplate(template([
      { type: "flowline_rule", requiredCount: 1 }
    ]))).toThrow("multiple completions");
    expect(() => validateQuestTemplate(template([
      { type: "collectible_targets", requiredCount: 1 }
    ]))).toThrow("at least three");
  });

  it("allows a one-target onboarding starter only when combined with a Flowline objective", () => {
    const starter = template([
      { type: "collectible_targets", requiredCount: 1, category: "place" },
      { type: "flowline_rule", requiredCount: 1 }
    ], { onboarding: true });
    expect(() => validateQuestTemplate(starter)).not.toThrow();
    expect(() => validateQuestTemplate(template(starter.objectives))).toThrow();
  });

  it("requires mixed quests to contain meaningful total work", () => {
    expect(() => validateQuestTemplate(template([
      { type: "collectible_count", requiredCount: 2, category: "place" },
      { type: "flowline_rule", requiredCount: 1 }
    ]))).toThrow("enough work");
  });
});

describe("bbox-local quest suggestion generation", () => {
  it("returns deterministic template instances only when the bbox has enough candidate content", () => {
    const curated = [
      template([{ type: "collectible_count", requiredCount: 3, category: "peak" }]),
      template([{ type: "flowline_rule", requiredCount: 2, minimumLengthMeters: 2000 }], { id: "flowlines" })
    ];
    const inputs = {
      templates: curated,
      collectibles: [collectible("p1", "peak"), collectible("p2", "peak"), collectible("p3", "peak")],
      flowlines: [flowline("f1"), flowline("f2", 1000)]
    };
    const suggestions = generateQuestSuggestions(inputs);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].templateId).toBe("test-template");
    expect(suggestions[0]).not.toHaveProperty("progress");
    expect(generateQuestSuggestions(inputs)).toEqual(suggestions);
    expect(generateQuestSuggestions({ ...inputs, collectibles: inputs.collectibles.slice(0, 2) })).toEqual([]);
  });

  it("resolves target sets into at least three frozen named collectibles", () => {
    const suggestion = generateQuestSuggestions({
      templates: [template([{ type: "collectible_targets", requiredCount: 3, category: "place" }])],
      collectibles: [collectible("c"), collectible("a"), collectible("b"), collectible("d", "peak")],
      flowlines: []
    })[0];
    expect(suggestion.objectives[0].targets.map((target) => target.id)).toEqual(["a", "b", "c"]);
  });

  it("excludes Flowlines already completed by the player from new recommendations", () => {
    const suggestion = generateQuestSuggestions({
      templates: [template([{ type: "flowline_rule", requiredCount: 2 }])],
      collectibles: [],
      flowlines: [
        { ...flowline("already-ridden"), completed: true, completionCount: 1 },
        flowline("available-1"),
        flowline("available-2"),
        flowline("available-3")
      ]
    })[0];

    expect(suggestion.objectives[0].targets.map((target) => target.id))
      .toEqual(["available-1", "available-2", "available-3"]);
  });

  it("generates Mountain Pass and mixed Mountain Pass/Flowline recommendations", async () => {
    const templates = await readQuestTemplateRows("fixtures/quest-templates.json");
    const legacyPass = collectible("pass-3", "mountain_pass");
    delete legacyPass.primaryCategory;
    const suggestions = generateQuestSuggestions({
      templates,
      collectibles: [
        collectible("pass-1", "mountain_pass"),
        collectible("pass-2", "mountain_pass"),
        legacyPass,
        collectible("peak-1", "peak"),
        collectible("peak-2", "peak"),
        collectible("peak-3", "peak"),
        collectible("place-1"),
        collectible("place-2"),
        collectible("place-3"),
        collectible("place-4")
      ],
      flowlines: ["f1", "f2", "f3", "f4", "f5"].map((id) => flowline(id))
    });
    const passQuest = suggestions.find((item) => item.templateId === "mountain-pass-discoveries");
    const mixedQuest = suggestions.find((item) => item.templateId === "mountain-passes-and-flowlines");
    expect(passQuest?.objectives[0]).toMatchObject({
      type: "collectible_count",
      category: "mountain_pass",
      requiredCount: 3
    });
    expect(mixedQuest?.objectives.map((objective) => objective.type)).toEqual([
      "collectible_count",
      "flowline_rule"
    ]);
  });
});

describe("quest objective history evaluation", () => {
  it("starts cancelled quest scopes with only history from the new start time", () => {
    const history = historyFromQuestStart({
      collectibles: [
        { sourceId: "before", timestampMs: 99 },
        { sourceId: "started", category: "peak", timestampMs: 100 },
        { sourceId: "after", timestampMs: 101 }
      ],
      flowlines: [
        { flowlineId: "before", activityId: "a1", lengthMeters: 1000, averageSpeedMps: 4, timestampMs: 99 },
        { flowlineId: "started", activityId: "a2", lengthMeters: 1000, averageSpeedMps: 4, timestampMs: 100 },
        { flowlineId: "after", activityId: "a3", lengthMeters: 1000, averageSpeedMps: 4, timestampMs: 101 }
      ]
    }, 100);
    expect(history.collectibles.map((event) => event.sourceId)).toEqual(["started", "after"]);
    expect(history.flowlines.map((completion) => completion.flowlineId)).toEqual(["started", "after"]);
    expect(history.flowlines.map((completion) => completion.timestampMs)).toEqual([100, 101]);
  });

  it("counts distinct qualifying Flowlines using length and average-speed snapshots", () => {
    const objective: QuestObjective = {
      id: "speed",
      type: "flowline_rule",
      requiredCount: 2,
      minimumLengthMeters: 2000,
      minimumAverageSpeedMps: 8,
      targets: [{ id: "f1", name: "One" }, { id: "f2", name: "Two" }, { id: "f3", name: "Three" }]
    };
    const result = evaluateQuestObjectives([objective], {
      collectibles: [],
      flowlines: [
        { flowlineId: "f1", activityId: "a1", lengthMeters: 2500, averageSpeedMps: 9, timestampMs: 100 },
        { flowlineId: "f1", activityId: "a2", lengthMeters: 2500, averageSpeedMps: 10, timestampMs: 200 },
        { flowlineId: "f1", activityId: "a3", lengthMeters: 2500, averageSpeedMps: 7, timestampMs: 300 },
        { flowlineId: "f2", activityId: "a1", lengthMeters: 1999, averageSpeedMps: 10, timestampMs: 100 },
        { flowlineId: "f3", activityId: "a2", lengthMeters: 3000, averageSpeedMps: 7, timestampMs: 100 }
      ]
    })[0];
    expect(result.progress).toEqual({ completed: 1, required: 2, complete: false });
    expect(result.targetProgress).toEqual([
      { id: "f1", name: "One", complete: true, averageSpeedMps: 10 },
      { id: "f2", name: "Two", complete: false },
      { id: "f3", name: "Three", complete: false }
    ]);
  });

  it("requires same-Activity Flowline completions to share an activity id", () => {
    const objective: QuestObjective = {
      id: "same-ride",
      type: "flowline_rule",
      requiredCount: 2,
      sameActivity: true,
      targets: [{ id: "f1", name: "One" }, { id: "f2", name: "Two" }]
    };
    const history = {
      collectibles: [],
      flowlines: [
        { flowlineId: "f1", activityId: "a1", lengthMeters: 1000, averageSpeedMps: 4 },
        { flowlineId: "f2", activityId: "a2", lengthMeters: 1000, averageSpeedMps: 4 }
      ]
    };
    expect(evaluateQuestObjectives([objective], history)[0].progress.complete).toBe(false);
    history.flowlines[1].activityId = "a1";
    expect(evaluateQuestObjectives([objective], history)[0].progress.complete).toBe(true);
  });

  it("counts distinct category discoveries and frozen targets from prior history", () => {
    const objectives: QuestObjective[] = [
      {
        id: "peaks",
        type: "collectible_count",
        requiredCount: 2,
        category: "peak",
        targets: [{ id: "p1", name: "Peak 1" }, { id: "p2", name: "Peak 2" }, { id: "p3", name: "Peak 3" }]
      },
      {
        id: "places",
        type: "collectible_targets",
        requiredCount: 2,
        targets: [{ id: "l1", name: "Landmark 1" }, { id: "l2", name: "Landmark 2" }]
      }
    ];
    const result = evaluateQuestObjectives(objectives, {
      collectibles: [
        { sourceId: "p1", category: "peak" },
        { sourceId: "p1", category: "peak" },
        { sourceId: "p2", category: "place" },
        { sourceId: "l1" },
        { sourceId: "l2" }
      ],
      flowlines: []
    });
    expect(result.map((item) => item.progress.complete)).toEqual([false, true]);
    expect(result[0].progress.completed).toBe(1);
    expect(result[0].targetProgress.map((target) => target.complete)).toEqual([true, false, false]);
    expect(result[1].targetProgress.map((target) => target.complete)).toEqual([true, true]);
  });

  it("evaluates mixed collectible and Flowline objectives independently", () => {
    const objectives: QuestObjective[] = [
      {
        id: "places",
        type: "collectible_targets",
        requiredCount: 1,
        targets: [{ id: "place-1", name: "Place" }]
      },
      {
        id: "flowlines",
        type: "flowline_rule",
        requiredCount: 2,
        targets: [{ id: "f1", name: "One" }, { id: "f2", name: "Two" }]
      }
    ];
    const result = evaluateQuestObjectives(objectives, {
      collectibles: [{ sourceId: "place-1" }],
      flowlines: [{ flowlineId: "f1", activityId: "a1", lengthMeters: 1000, averageSpeedMps: 4 }]
    });
    expect(result.map((item) => item.progress)).toEqual([
      { completed: 1, required: 1, complete: true },
      { completed: 1, required: 2, complete: false }
    ]);
    expect(result[1].targetProgress[0]).toMatchObject({ complete: true, averageSpeedMps: 4 });
  });
});
