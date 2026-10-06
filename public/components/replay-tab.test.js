import { describe, expect, it } from "vitest";
import { closestApproachTimestamp, FartlekCompletionsSection, replayPanelRows, rowStateAt } from "./replay-tab.js";

describe("FartlekCompletionsSection", () => {
  it("renders nothing when no Fartlek was completed", () => {
    expect(FartlekCompletionsSection([])).toBe("");
    expect(FartlekCompletionsSection(undefined)).toBe("");
  });

  it("shows name, length, elapsed time and average speed per completed Fartlek", () => {
    const markup = FartlekCompletionsSection([{
      fartlekId: "fartlek-1",
      fartlekName: "Harbour Straight",
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
    expect(markup).not.toContain("max ");
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
