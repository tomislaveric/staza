import { describe, expect, it } from "vitest";
import { SKILL_TREE_NODES } from "../skillTree/catalog.js";
import { QUEST_XP_BY_DIFFICULTY } from "../questObjectives.js";
import { AUTHORED_QUEST_CHAINS } from "./catalog.js";
import {
  buildAuthoredQuestViews,
  evaluateAuthoredQuestCriteria,
  nextAuthoredQuestAfter,
  meetsAuthoredQuestCriteria,
  type ActivityQuestMetrics
} from "./evaluator.js";
import { capabilitiesFromGrants } from "../skillTree/capabilities.js";

const metrics = (overrides: Partial<ActivityQuestMetrics> = {}): ActivityQuestMetrics => ({
  sport: "cycling", distanceKm: 0, averageSpeedKmh: 0, elevationGainM: 0,
  collectibles: 0, categoryCounts: {}, flowlines: 0, ...overrides
});

describe("authored quest catalog", () => {
  it("has one chain for every quest_unlock grant and none for other nodes", () => {
    const grantNodes = SKILL_TREE_NODES.filter((node) => node.grant.type === "quest_unlock");
    expect(AUTHORED_QUEST_CHAINS.map((chain) => chain.nodeId).sort()).toEqual(grantNodes.map((node) => node.id).sort());
    for (const chain of AUTHORED_QUEST_CHAINS) {
      expect(chain.quests.length).toBeGreaterThanOrEqual(2);
      for (const quest of chain.quests) expect(quest.xp).toBe(QUEST_XP_BY_DIFFICULTY[quest.difficulty]);
    }
  });

  it("uses unique quest ids", () => {
    const ids = AUTHORED_QUEST_CHAINS.flatMap((chain) => chain.quests.map((quest) => quest.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("authored quest evaluation", () => {
  const rusher = "rusher-i";
  const firstId = "flow-quests:1";

  it("requires every criterion on the same activity and the right sport", () => {
    const criteria = { sport: "running", minDistanceKm: 5, minAverageSpeedKmh: 10 } as const;
    expect(meetsAuthoredQuestCriteria(criteria, metrics({ sport: "running", distanceKm: 5, averageSpeedKmh: 10 }))).toBe(true);
    expect(meetsAuthoredQuestCriteria(criteria, metrics({ sport: "cycling", distanceKm: 5, averageSpeedKmh: 10 }))).toBe(false);
    expect(meetsAuthoredQuestCriteria(criteria, metrics({ sport: "running", distanceKm: 5, averageSpeedKmh: 9 }))).toBe(false);
  });

  it("reports exactly which criteria fell short", () => {
    const results = evaluateAuthoredQuestCriteria(
      { sport: "running", minDistanceKm: 5, minAverageSpeedKmh: 10 },
      metrics({ sport: "running", distanceKm: 5.04, averageSpeedKmh: 9 })
    );
    expect(results.filter((result) => !result.met).map((result) => result.label)).toEqual(["Average speed"]);
  });

  it("derives the XP from difficulty and offers the next step in the chain", () => {
    expect(nextAuthoredQuestAfter(firstId)?.id).toBe("flow-quests:2");
    expect(nextAuthoredQuestAfter("flow-quests:2")).toBeUndefined();
    expect(QUEST_XP_BY_DIFFICULTY).toEqual({ easy: 100, medium: 250, hard: 500, prestige: 1000 });
  });

  it("marks active and failed attempts in the quest views", () => {
    const attempt = { status: "failed" as const, attemptCount: 2, startedAt: "2026-01-01T00:00:00.000Z" };
    const views = buildAuthoredQuestViews(new Set([rusher]), new Map(), new Map([[firstId, attempt]]));
    expect(views.find((quest) => quest.id === firstId)).toMatchObject({ state: "failed", attempt });
  });

  it("shows locked quests with the node that unlocks them and gates later steps", () => {
    const locked = buildAuthoredQuestViews(new Set(), new Map()).find((quest) => quest.id === firstId)!;
    expect(locked).toMatchObject({ state: "locked", requiredNode: { id: rusher } });
    const unlocked = buildAuthoredQuestViews(new Set([rusher]), new Map());
    expect(unlocked.find((quest) => quest.id === firstId)?.state).toBe("available");
    expect(unlocked.find((quest) => quest.id === "flow-quests:2")).toMatchObject({ state: "locked", requiredQuestTitle: expect.any(String) });
    const done = buildAuthoredQuestViews(new Set([rusher]), new Map([[firstId, "2026-01-01T00:00:00.000Z"]]));
    expect(done.find((quest) => quest.id === firstId)?.state).toBe("completed");
    expect(done.find((quest) => quest.id === "flow-quests:2")?.state).toBe("available");
  });
});

describe("Atlas grant consumers", () => {
  it("every non-hub node of a sport transitively requires that sport's tree_access hub", () => {
    const byId = new Map(SKILL_TREE_NODES.map((node) => [node.id, node]));
    const requires = (id: string, hubId: string, seen = new Set<string>()): boolean => {
      if (id === hubId) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return (byId.get(id)?.prerequisites ?? []).some((pre) => requires(pre, hubId, seen));
    };
    for (const hub of SKILL_TREE_NODES.filter((node) => node.grant.type === "tree_access")) {
      for (const node of SKILL_TREE_NODES.filter((item) => item.sport === hub.sport && item.id !== hub.id)) {
        expect(requires(node.id, hub.id), `${node.id} -> ${hub.id}`).toBe(true);
      }
    }
  });

  it("maps grants to filters, titles and badges", () => {
    const caps = capabilitiesFromGrants([
      { type: "world_filter", value: "peaks-only", label: "Peaks" },
      { type: "segment_filter", value: "long-endurance", label: "Long" },
      { type: "title", value: "t", label: "Earns the Flow Master title" },
      { type: "badge", value: "b", label: "Badge" },
      { type: "quest_unlock", value: "q", label: "Q" }
    ]);
    expect(caps).toEqual({
      worldFilters: ["peaks-only", "long-endurance"],
      titles: [{ id: "t", label: "Flow Master" }],
      badges: [{ id: "b", label: "Badge" }]
    });
  });
});
