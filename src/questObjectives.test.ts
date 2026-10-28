import { describe, expect, it } from "vitest";
import type { QuestObjective } from "./domain.js";
import { evaluateQuestObjectives } from "./questObjectives.js";

describe("quest objective history evaluation", () => {
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
