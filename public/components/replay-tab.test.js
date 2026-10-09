import { describe, expect, it } from "vitest";
import {
  closestApproachTimestamp,
  FartlekCompletionsSection,
  flowlineStateAt,
  replayPanelRows,
  replayRewardItems,
  replayRewardStateAt,
  replayRewardWindowMs,
  rowStateAt
} from "./replay-tab.js";

describe("FartlekCompletionsSection", () => {
  it("renders nothing when no Fartlek was completed", () => {
    expect(FartlekCompletionsSection([])).toBe("");
    expect(FartlekCompletionsSection(undefined)).toBe("");
  });

  it("shows name, length, elapsed time and average speed per completed Fartlek", () => {
    const markup = FartlekCompletionsSection([{
      fartlekId: "fartlek-1",
      fartlekName: "Harbour Straight",
      completedAtTimestampMs: 2_000,
      fartlekLengthMSnapshot: 3_000,
      elapsedTimeS: 600,
      averageSpeedMps: 5,
      traversalDirection: "a_to_b",
      fartlekGeometryVersionSnapshot: 1
    }]);
    expect(markup).toContain("Harbour Straight");
    expect(markup).toContain("3.0 km");
    expect(markup).toContain("10:00");
    expect(markup).toContain("18.0 km/h");
    expect(markup).toContain("Flowlines completed");
    expect(markup).toContain('aria-label="Completed Flowlines"');
    expect(markup).toContain('data-flowline-row="fartlek-1"');
    expect(markup).toContain('class="fartlek-swatch is-unvisited"');
    expect(markup).not.toContain("max ");
  });

  it("keeps each flowline swatch grey until the collection timestamp, then marks it completed", () => {
    const completion = { completedAtTimestampMs: 2_000 };
    expect(flowlineStateAt(completion, 1_999)).toBe("unvisited");
    expect(flowlineStateAt(completion, 2_000)).toBe("completed");
    expect(flowlineStateAt(completion, 3_000)).toBe("completed");
  });

  it("treats completions without a timestamp as already completed", () => {
    expect(flowlineStateAt({}, 0)).toBe("completed");
  });

  it("includes an optional max speed when present", () => {
    const markup = FartlekCompletionsSection([{
      fartlekId: "fartlek-1",
      fartlekName: "Harbour Straight",
      fartlekLengthMSnapshot: 3_000,
      elapsedTimeS: 600,
      averageSpeedMps: 5,
      maxSpeedMps: 7.5,
      traversalDirection: "a_to_b",
      fartlekGeometryVersionSnapshot: 1
    }]);
    expect(markup).toContain("max 27.0 km/h");
  });
});

describe("replayPanelRows / rowStateAt", () => {
  it("still builds collectible and near-miss rows unaffected by Fartlek completions", () => {
    const replay = {
      activity: { route: [{ latitude: 50, longitude: 8, timestampMs: 0 }] },
      activityResult: {
        collectibles: [{ id: "c1", name: "Coin" }],
        events: [{ sourceId: "c1", collectible: { name: "Coin", rarity: "rare" }, activityTimestamp: 10 }],
        nearMisses: [],
        fartlekCompletions: []
      }
    };
    const rows = replayPanelRows(replay);
    expect(rows).toHaveLength(1);
    expect(rowStateAt(rows[0], 20)).toBe("completed");
    expect(rowStateAt(rows[0], 0)).toBe("unvisited");
  });

  it("exposes closestApproachTimestamp unchanged", () => {
    const route = [{ latitude: 50, longitude: 8, timestampMs: 0 }, { latitude: 50.001, longitude: 8.001, timestampMs: 1000 }];
    const timestamp = closestApproachTimestamp(route, { latitude: 50.001, longitude: 8.001 });
    expect(timestamp).toBe(1000);
  });
});

describe("replayRewardItems / replayRewardStateAt", () => {
  const replay = {
    activityResult: {
      totalPoints: 110,
      events: [
        { sourceId: "peak", activityTimestamp: 3_000, value: 40, collectible: { name: "Peak", type: "landmark" } },
        { sourceId: "coin", activityTimestamp: 1_000, value: 20, collectible: { name: "Park Coin", type: "coin" } }
      ],
      fartlekCompletions: [{
        fartlekId: "flowline-1",
        fartlekName: "Harbour Straight",
        completedAtTimestampMs: 2_000
      }]
    }
  };

  it("orders collectible and Flowline rewards chronologically using persisted XP for Flowlines", () => {
    const items = replayRewardItems(replay, 110);

    expect(items.map(({ kind, name, xpGain }) => ({ kind, name, xpGain }))).toEqual([
      { kind: "collectible", name: "Park Coin", xpGain: 20 },
      { kind: "flowline", name: "Harbour Straight", xpGain: 50 },
      { kind: "collectible", name: "Peak", xpGain: 40 }
    ]);
  });

  it("derives one temporary reward and cumulative XP from any replay timestamp", () => {
    const items = replayRewardItems(replay, 110);

    expect(replayRewardStateAt(items, 999)).toMatchObject({ reward: undefined, cumulativeXp: 0 });
    expect(replayRewardStateAt(items, 1_000)).toMatchObject({ reward: { name: "Park Coin" }, cumulativeXp: 20 });
    expect(replayRewardStateAt(items, 1_999).reward?.name).toBe("Park Coin");
    expect(replayRewardStateAt(items, 2_000)).toMatchObject({ reward: { name: "Harbour Straight" }, cumulativeXp: 70 });
    expect(replayRewardStateAt(items, 2_999).reward?.name).toBe("Harbour Straight");
    expect(replayRewardStateAt(items, 3_000)).toMatchObject({ reward: { name: "Peak" }, cumulativeXp: 110 });
    expect(replayRewardStateAt(items, 4_500)).toMatchObject({ reward: undefined, cumulativeXp: 110 });
    expect(replayRewardStateAt(items, 1_000)).toMatchObject({ reward: { name: "Park Coin" }, cumulativeXp: 20 });
  });

  it("uses a stable order for rewards with identical timestamps", () => {
    const items = replayRewardItems({
      activityResult: {
        events: [{ sourceId: "coin", activityTimestamp: 1_000, value: 10, collectible: { name: "Coin", type: "coin" } }],
        fartlekCompletions: [{ fartlekId: "line", fartlekName: "Line", completedAtTimestampMs: 1_000 }]
      }
    }, 60);

    expect(items.map((item) => item.kind)).toEqual(["collectible", "flowline"]);
    expect(replayRewardStateAt(items, 1_000)).toMatchObject({
      reward: { kind: "flowline" },
      cumulativeXp: 60
    });
  });

  it("maps the 1,500 ms presentation window onto the compressed activity timeline", () => {
    expect(replayRewardWindowMs({
      activity: { startedAt: 0, endedAt: 3_600_000 },
      activityResult: { duration: 3_600 }
    })).toBe(180_000);
  });
});
