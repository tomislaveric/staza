import { describe, expect, it } from "vitest";
import { SKILL_TREE_NODES } from "../skillTree/catalog.js";
import { AUTHORED_QUEST_CHAINS } from "./catalog.js";
import {
  buildAuthoredQuestViews,
  completableAuthoredQuests,
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
      expect(chain.quests.map((quest) => quest.xp)).toEqual([...chain.quests.map((quest) => quest.xp)].sort((a, b) => a - b));
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

  it("only completes quests of unlocked chains, one step per chain per activity", () => {
    const big = metrics({ flowlines: 10 });
    expect(completableAuthoredQuests(new Set(), new Set(), big)).toEqual([]);
    const first = completableAuthoredQuests(new Set([rusher]), new Set(), big);
    expect(first.map((quest) => quest.id)).toEqual([firstId]);
    const second = completableAuthoredQuests(new Set([rusher]), new Set([firstId]), big);
    expect(second.map((quest) => quest.id)).toEqual(["flow-quests:2"]);
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
