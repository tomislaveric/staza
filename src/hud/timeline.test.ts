import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createHudTimeline, loadHudTimeline } from "./timeline.js";

describe("HUD timeline", () => {
  it("retains complete GameEvent contracts in chronological video order", () => {
    const timeline = createHudTimeline(
      [
        { latitude: 48, longitude: 11, timestampMs: 1_000 },
        { latitude: 48.001, longitude: 11, timestampMs: 2_000 }
      ],
      [{ id: "coin", name: "Coin", type: "coin", latitude: 48.001, longitude: 11, radiusMeters: 5, value: 100 }],
      [
        { id: "later", sourceId: "later", type: "collectible_collected", collectible: { name: "Later", type: "landmark" }, value: 200, latitude: 48.001, longitude: 11, activityTimestamp: 1_900.25, videoSecond: 9 },
        { id: "first", sourceId: "first", type: "collectible_collected", collectible: { name: "First", type: "coin" }, value: 100, latitude: 48, longitude: 11, activityTimestamp: 1_100.5, videoSecond: 1 }
      ],
      [
        { timestampMs: 1_000, videoSeconds: 0 },
        { timestampMs: 2_000, videoSeconds: 10 }
      ],
      10
    );

    expect(timeline.events).toEqual([
      { id: "first", sourceId: "first", type: "collectible_collected", collectible: { name: "First", type: "coin" }, value: 100, latitude: 48, longitude: 11, activityTimestamp: 1_100.5, videoSecond: 1 },
      { id: "later", sourceId: "later", type: "collectible_collected", collectible: { name: "Later", type: "landmark" }, value: 200, latitude: 48.001, longitude: 11, activityTimestamp: 1_900.25, videoSecond: 9 }
    ]);
  });

  it("rejects timelines with incomplete GameEvent data", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "post-ride-ar-hud-"));
    const file = path.join(directory, "timeline.json");
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        track: [
          { latitude: 48, longitude: 11, videoSecond: 0 },
          { latitude: 48.001, longitude: 11, videoSecond: 1 }
        ],
        collectibles: [],
        events: [{ id: "coin", type: "coin", value: 100, latitude: 48, longitude: 11, videoSecond: 1 }]
      })
    );

    await expect(loadHudTimeline(file)).rejects.toThrow("HUD timeline could not be loaded");
  });

  it("serializes the supplied relevant collectible subset unchanged", () => {
    const relevant = [{ id: "near", name: "Near", type: "coin" as const, latitude: 48, longitude: 11, radiusMeters: 5, value: 100 }];
    const timeline = createHudTimeline(
      [
        { latitude: 48, longitude: 11, timestampMs: 1_000 },
        { latitude: 48.001, longitude: 11, timestampMs: 2_000 }
      ],
      relevant,
      [],
      [
        { timestampMs: 1_000, videoSeconds: 0 },
        { timestampMs: 2_000, videoSeconds: 10 }
      ],
      10
    );

    expect(timeline.collectibles).toBe(relevant);
  });
});
