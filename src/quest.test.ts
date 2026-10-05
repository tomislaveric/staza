import { describe, expect, it } from "vitest";
import {
  createQuestRouteSnapshot,
  deriveQuestCenter,
  deriveQuestProgress,
  parseQuestInput,
  routeLengthMeters,
  simplifyRoute,
  suggestQuestTitle
} from "./quest.js";
import { UserInputError } from "./errors.js";

const point = (latitude: number, longitude: number, timestampMs = 0) => ({ latitude, longitude, timestampMs });

describe("quest progress", () => {
  it("derives progress from the intersection with canonical player history", () => {
    expect(deriveQuestProgress(["a", "b", "c", "d"], ["b", "d", "z"])).toEqual({
      collected: 2, total: 4, ratio: 0.5, complete: false
    });
  });

  it("marks a quest complete only when every collectible was collected", () => {
    expect(deriveQuestProgress(["a", "b"], ["a", "b"]).complete).toBe(true);
    expect(deriveQuestProgress(["a", "b"], ["a"]).complete).toBe(false);
  });

  it("never reports an empty quest as complete and never divides by zero", () => {
    expect(deriveQuestProgress([], ["a"])).toEqual({ collected: 0, total: 0, ratio: 0, complete: false });
  });

  it("ignores duplicate quest ids and collected ids the quest does not contain", () => {
    expect(deriveQuestProgress(["a", "a", "b"], ["a", "a", "x"])).toEqual({
      collected: 1, total: 2, ratio: 0.5, complete: false
    });
  });
});

describe("quest placement", () => {
  it("centres a quest on its collectibles", () => {
    expect(deriveQuestCenter([
      { latitude: 48, longitude: 8 },
      { latitude: 50, longitude: 10 }
    ])).toEqual({ latitude: 49, longitude: 9 });
  });

  it("falls back to the route when a quest has no collectibles", () => {
    const center = deriveQuestCenter([], {
      geometry: { type: "LineString", coordinates: [[8, 48], [10, 50]] }
    });
    expect(center).toEqual({ latitude: 49, longitude: 9 });
  });

  it("rejects a quest that cannot be placed in the world", () => {
    expect(() => deriveQuestCenter([])).toThrow(UserInputError);
  });
});

describe("route snapshots", () => {
  it("keeps a short route untouched and caps a long one", () => {
    const short = [point(49, 8), point(49.001, 8.001)];
    expect(simplifyRoute(short, 2000)).toBe(short);

    const long = Array.from({ length: 5000 }, (_value, index) => point(49 + index / 200_000, 8 + index / 100_000, index));
    expect(simplifyRoute(long, 100).length).toBeLessThanOrEqual(100);
  });

  it("preserves the first and last point when simplifying", () => {
    const route = Array.from({ length: 800 }, (_value, index) => point(49 + Math.sin(index / 9) / 900, 8 + index / 40_000, index));
    const simplified = simplifyRoute(route, 50);
    expect(simplified[0]).toEqual(route[0]);
    expect(simplified[simplified.length - 1]).toEqual(route[route.length - 1]);
  });

  it("builds a GeoJSON snapshot that records the source activity, distance, and type", () => {
    const snapshot = createQuestRouteSnapshot(
      { id: "activity-1", type: "cycling", route: [point(49, 8), point(49.01, 8.01)], distance: 1400 },
      2000
    );
    expect(snapshot).toEqual({
      sourceActivityId: "activity-1",
      geometry: { type: "LineString", coordinates: [[8, 49], [8.01, 49.01]] },
      distanceMeters: 1400,
      activityType: "cycling"
    });
  });

  it("derives distance from the geometry when the activity has none", () => {
    const snapshot = createQuestRouteSnapshot(
      { id: "activity-2", type: "running", route: [point(49, 8), point(49.01, 8)] },
      2000
    );
    expect(snapshot?.distanceMeters).toBeGreaterThan(1000);
    expect(snapshot?.distanceMeters).toBeLessThan(1200);
  });

  it("produces no snapshot for an activity without a usable route", () => {
    expect(createQuestRouteSnapshot({ id: "a", type: "cycling", route: [] }, 2000)).toBeUndefined();
    expect(createQuestRouteSnapshot({ id: "a", type: "cycling", route: [point(49, 8)] }, 2000)).toBeUndefined();
  });

  it("measures route length along the track", () => {
    expect(routeLengthMeters([])).toBe(0);
    expect(routeLengthMeters([{ latitude: 49, longitude: 8 }])).toBe(0);
    expect(routeLengthMeters([{ latitude: 49, longitude: 8 }, { latitude: 49.01, longitude: 8 }]))
      .toBeGreaterThan(1000);
  });
});

describe("quest input parsing", () => {
  it("accepts a complete create payload and removes duplicate collectible ids", () => {
    const parsed = parseQuestInput({
      title: " Best viewpoints ",
      description: " Ride the ridge ",
      collectibleIds: ["a", "b", "a"],
      sourceActivityId: "activity-1"
    }, { requireTitle: true });
    expect(parsed.title).toBe("Best viewpoints");
    expect(parsed.description).toBe("Ride the ridge");
    expect(parsed.collectibleIds).toEqual(["a", "b"]);
    expect(parsed.sourceActivityId).toBe("activity-1");
  });

  it("requires a title and collectible list when creating", () => {
    expect(() => parseQuestInput({ collectibleIds: [] }, { requireTitle: true })).toThrow(UserInputError);
    expect(() => parseQuestInput({ title: "   ", collectibleIds: [] }, { requireTitle: true })).toThrow(UserInputError);
    expect(() => parseQuestInput({ title: "Ok" }, { requireTitle: true })).toThrow(UserInputError);
  });

  it("allows partial patches", () => {
    expect(parseQuestInput({ title: "New" }, { requireTitle: false }).title).toBe("New");
    expect(parseQuestInput({ description: "Updated" }, { requireTitle: false }).description).toBe("Updated");
  });

  it("rejects malformed collectible lists and oversized text", () => {
    expect(() => parseQuestInput({ title: "Ok", collectibleIds: [1] }, { requireTitle: true })).toThrow(UserInputError);
    expect(() => parseQuestInput({ title: "x".repeat(200), collectibleIds: [] }, { requireTitle: true })).toThrow(UserInputError);
    expect(() => parseQuestInput({ title: "Ok", collectibleIds: [], description: "x".repeat(2100) }, { requireTitle: true }))
      .toThrow(UserInputError);
    expect(() => parseQuestInput("nope", { requireTitle: true })).toThrow(UserInputError);
  });
});

describe("quest title suggestions", () => {
  it("uses sport-specific presentation language with the activity date", () => {
    expect(suggestQuestTitle("cycling", "2026-02-12T09:00:00.000Z")).toBe("Ride \u00b7 12 Feb");
    expect(suggestQuestTitle("running", "2026-02-12T09:00:00.000Z")).toBe("Run \u00b7 12 Feb");
    expect(suggestQuestTitle("unknown", "2026-02-12T09:00:00.000Z")).toBe("Activity \u00b7 12 Feb");
  });

  it("omits an unusable date", () => {
    expect(suggestQuestTitle("hiking", "not-a-date")).toBe("Hike");
  });
});
