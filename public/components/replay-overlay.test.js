import { describe, expect, it } from "vitest";
import { closestApproachTimestamp, panelFitPadding, replayPanelRows, rowStateAt } from "./replay-tab.js";

const route = [
  { latitude: 0, longitude: 0, timestampMs: 1_000 },
  { latitude: 0, longitude: 1, timestampMs: 2_000 },
  { latitude: 0, longitude: 2, timestampMs: 3_000 }
];

describe("closestApproachTimestamp", () => {
  it("returns the timestamp of the nearest route point to a collectible", () => {
    expect(closestApproachTimestamp(route, { latitude: 0, longitude: 1.01 })).toBe(2_000);
    expect(closestApproachTimestamp([], { latitude: 0, longitude: 0 })).toBeUndefined();
  });
});

describe("replayPanelRows", () => {
  const replay = {
    activity: { route },
    activityResult: {
      collectibles: [{ id: "near-1", latitude: 0, longitude: 2 }],
      events: [{ sourceId: "coin-1", collectible: { name: "Coin", rarity: "rare" }, activityTimestamp: 1_500 }],
      nearMisses: [{ collectibleId: "near-1", name: "Peak", rarity: "epic", minimumDistanceMeters: 20 }]
    }
  };

  it("orders collected collectibles before near misses with their reach times", () => {
    const rows = replayPanelRows(replay);
    expect(rows.map((row) => row.id)).toEqual(["coin-1", "near-1"]);
    expect(rows[0]).toMatchObject({ kind: "collectible", reachMs: 1_500, name: "Coin" });
    expect(rows[1]).toMatchObject({ kind: "near-miss", reachMs: 3_000, name: "Peak" });
  });
});

describe("rowStateAt", () => {
  it("flips a collectible to completed once the replay reaches it", () => {
    const row = { kind: "collectible", reachMs: 1_500 };
    expect(rowStateAt(row, 1_000)).toBe("unvisited");
    expect(rowStateAt(row, 2_000)).toBe("completed");
  });

  it("flips a near miss to nearby-miss at its closest approach", () => {
    const row = { kind: "near-miss", reachMs: 3_000 };
    expect(rowStateAt(row, 2_000)).toBe("unvisited");
    expect(rowStateAt(row, 3_000)).toBe("nearby-miss");
  });

  it("stays unvisited when a reach time is unknown", () => {
    expect(rowStateAt({ kind: "near-miss", reachMs: undefined }, 9_999)).toBe("unvisited");
  });
});

describe("panelFitPadding", () => {
  const container = {
    getBoundingClientRect: () => ({ top: 0, right: 400, bottom: 420, left: 0, width: 400 })
  };

  it("does not reserve map space when the mobile panel is below the map", () => {
    const panel = {
      hidden: false,
      getBoundingClientRect: () => ({ top: 432, right: 388, bottom: 700, left: 12, width: 376 })
    };

    expect(panelFitPadding(container, panel)).toBe(48);
  });

  it("still reserves space for the desktop overlay", () => {
    const panel = {
      hidden: false,
      getBoundingClientRect: () => ({ top: 14, right: 386, bottom: 406, left: 200, width: 186 })
    };

    expect(panelFitPadding(container, panel)).toMatchObject({ left: 48, right: 212 });
  });
});
