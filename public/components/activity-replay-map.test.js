import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStazaMap } from "./shared/map/staza-map.js";
import {
  activityCollectibleSources,
  activityFlowlineSources,
  mountReplayMap,
  replayTimestamp,
  traveledCoordinates
} from "./activity-replay-map.js";

vi.mock("./shared/map/staza-map.js", () => ({ createStazaMap: vi.fn() }));
vi.mock("./shared/map/staza-route-layers.js", () => ({
  stazaRouteLayers: () => [],
  stazaSubduedRouteLayers: () => []
}));
vi.mock("./shared/map/staza-fartlek-layers.js", () => ({
  ensureFartlekLayers: vi.fn(),
  fartleksToFeatureCollection: () => ({ type: "FeatureCollection", features: [] }),
  setFartlekData: vi.fn()
}));
vi.mock("./shared/map/staza-collectible-layers.js", () => ({
  ensureCollectibleLayers: vi.fn(),
  setCollectibleData: vi.fn()
}));
vi.mock("./shared/map/staza-collectible-features.js", () => ({
  collectiblesToFeatureCollection: () => ({ type: "FeatureCollection", features: [] })
}));
vi.mock("./shared/map/staza-map-utils.js", () => ({
  lineFeature: () => ({ type: "Feature" }),
  pointFeature: () => ({ type: "Feature" }),
  pointsToBounds: () => undefined
}));

const route = [
  { longitude: 0, latitude: 0, timestampMs: 1_000 },
  { longitude: 10, latitude: 20, timestampMs: 3_000 }
];

beforeEach(() => {
  const sources = new Map();
  const map = {
    addSource: (id, config) => sources.set(id, {
      ...config,
      setData(data) {
        this.data = data;
      }
    }),
    addLayer: vi.fn(),
    getSource: (id) => sources.get(id),
    fitBounds: vi.fn()
  };
  createStazaMap.mockResolvedValue({ map, ready: Promise.resolve(), destroy: vi.fn() });
});

afterEach(() => vi.unstubAllGlobals());

describe("replayTimestamp", () => {
  it("maps playback progress onto the activity's absolute time and clamps to the range", () => {
    const activity = { startedAt: 1_000, endedAt: 3_000 };

    expect(replayTimestamp(activity, 0)).toBe(1_000);
    expect(replayTimestamp(activity, 0.5)).toBe(2_000);
    expect(replayTimestamp(activity, 1)).toBe(3_000);
    expect(replayTimestamp(activity, 1.5)).toBe(3_000);
    expect(replayTimestamp(activity, -1)).toBe(1_000);
  });
});

describe("traveledCoordinates", () => {
  it("includes only passed points plus the interpolated current head so the line reaches the rider", () => {
    const coordinates = traveledCoordinates(route, 2_000);

    expect(coordinates[0]).toEqual([0, 0]);
    expect(coordinates.at(-1)).toEqual([5, 10]);
  });

  it("covers the whole route once playback has finished", () => {
    expect(traveledCoordinates(route, 3_000)).toEqual([[0, 0], [10, 20], [10, 20]]);
  });
});

describe("activityCollectibleSources", () => {
  const sources = [{ id: "c1", longitude: 0, latitude: 0 }];
  const events = [{ sourceId: "c1", activityTimestamp: 1_000 }];

  it("marks a collectible collected only after the historical event's feedback window", () => {
    const [pending] = activityCollectibleSources(sources, events, 1_200);
    const [collected] = activityCollectibleSources(sources, events, 3_000);

    expect(pending.activityCollected).toBe(false);
    expect(pending.activityPending).toBe(true);
    expect(collected.activityCollected).toBe(true);
    expect(collected.activityPending).toBe(false);
  });

  it("never claims global discovery so it cannot alter World visited state", () => {
    const [decorated] = activityCollectibleSources([{ id: "c1", found: true }], events, 3_000);

    expect(decorated.found).toBe(false);
  });
});

describe("activityFlowlineSources", () => {
  const completion = {
    fartlekId: "flowline-1",
    fartlekName: "Harbour Straight",
    fartlekGeometry: { type: "LineString", coordinates: [[8, 49], [8.1, 49.1]] },
    completedAtTimestampMs: 2_000
  };

  it("reveals a completed flowline at its completion timestamp and keeps it in the completed state", () => {
    expect(activityFlowlineSources([completion], 1_999)).toEqual([]);
    expect(activityFlowlineSources([completion], 2_000)).toEqual([{
      id: "flowline-1",
      name: "Harbour Straight",
      geometry: completion.fartlekGeometry,
      completed: true
    }]);
    expect(activityFlowlineSources([completion], 3_000)).toHaveLength(1);
  });

  it("skips older replay completions without saved geometry", () => {
    expect(activityFlowlineSources([{ ...completion, fartlekGeometry: undefined }], 3_000)).toEqual([]);
  });
});

describe("mountReplayMap replay lifecycle", () => {
  it("distinguishes replay start, pause, natural completion, and restart", async () => {
    const frames = new Map();
    let nextFrameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback) => {
      const id = ++nextFrameId;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id) => frames.delete(id));

    const onReplayStart = vi.fn();
    const onReplayComplete = vi.fn();
    const player = await mountReplayMap({
      container: {},
      activity: {
        startedAt: 1_000,
        endedAt: 3_000,
        route
      },
      activityResult: {
        duration: 12,
        collectibles: [],
        events: [],
        fartlekCompletions: []
      },
      onReplayStart,
      onReplayComplete
    });

    player.play();
    expect(onReplayStart).toHaveBeenCalledTimes(1);
    player.pause();
    expect(onReplayComplete).not.toHaveBeenCalled();

    player.play();
    expect(onReplayStart).toHaveBeenCalledTimes(1);
    const firstFrameId = [...frames.keys()].at(-1);
    const firstFrame = frames.get(firstFrameId);
    frames.delete(firstFrameId);
    firstFrame(0);
    const finalFrameId = [...frames.keys()].at(-1);
    const finalFrame = frames.get(finalFrameId);
    frames.delete(finalFrameId);
    finalFrame(12_000);
    expect(onReplayComplete).toHaveBeenCalledTimes(1);

    player.play();
    expect(onReplayStart).toHaveBeenCalledTimes(2);
    player.pause();
    player.restart();
    expect(onReplayStart).toHaveBeenCalledTimes(3);
    expect(onReplayComplete).toHaveBeenCalledTimes(1);
    player.destroy();
  });
});
