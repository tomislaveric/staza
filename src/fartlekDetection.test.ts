import { describe, expect, it } from "vitest";
import { detectFartlekTraversal, deriveFartlekCompletionDrafts, resampleRoute } from "./fartlekDetection.js";
import type { Fartlek, TrackPoint } from "./domain.js";

const METERS_PER_DEGREE_LAT = 111_320;
const LAT = 50;
const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos((LAT * Math.PI) / 180);
const lonOffset = (meters: number) => meters / metersPerDegreeLon;
const latOffset = (meters: number) => meters / METERS_PER_DEGREE_LAT;
const START_LON = 10;

const SEGMENT_LENGTH_METERS = 3_000;

const fartlek: Pick<Fartlek, "geometry" | "lengthMeters" | "status" | "geometryVersion" | "id" | "name"> = {
  id: "fartlek-1",
  name: "Test Fartlek",
  geometry: {
    type: "LineString",
    coordinates: [
      [START_LON, LAT],
      [START_LON + lonOffset(SEGMENT_LENGTH_METERS), LAT]
    ]
  },
  lengthMeters: SEGMENT_LENGTH_METERS,
  status: "published",
  geometryVersion: 1
};

/** A straight route from `fromMeters` to `toMeters` (arc-length along the fartlek axis), at a given lateral offset. */
const straightRoute = (
  fromMeters: number,
  toMeters: number,
  options: { stepMeters?: number; lateralOffsetMeters?: number; speedMps?: number } = {}
): TrackPoint[] => {
  const stepMeters = options.stepMeters ?? 20;
  const lateralOffsetMeters = options.lateralOffsetMeters ?? 0;
  const speedMps = options.speedMps ?? 5;
  const points: TrackPoint[] = [];
  const direction = toMeters >= fromMeters ? 1 : -1;
  let position = fromMeters;
  let timestampMs = 0;
  while (direction === 1 ? position <= toMeters : position >= toMeters) {
    points.push({
      latitude: LAT + latOffset(lateralOffsetMeters),
      longitude: START_LON + lonOffset(position),
      timestampMs
    });
    const remaining = Math.abs(toMeters - position);
    const advance = Math.min(stepMeters, remaining || stepMeters);
    if (remaining === 0) break;
    position += direction * advance;
    timestampMs += (advance / speedMps) * 1000;
  }
  points.push({
    latitude: LAT + latOffset(lateralOffsetMeters),
    longitude: START_LON + lonOffset(toMeters),
    timestampMs
  });
  return points;
};

describe("resampleRoute", () => {
  it("preserves the last point and emits uniform steps", () => {
    const route = straightRoute(0, 100, { stepMeters: 50 });
    const resampled = resampleRoute(route, 10);
    expect(resampled[resampled.length - 1]).toEqual(route[route.length - 1]);
    expect(resampled.length).toBeGreaterThan(5);
  });
});

describe("detectFartlekTraversal", () => {
  it("completes on a full A->B traversal", () => {
    const route = straightRoute(-50, SEGMENT_LENGTH_METERS + 50);
    const result = detectFartlekTraversal(route, fartlek);
    expect(result.completed).toBe(true);
    expect(result.direction).toBe("a_to_b");
    expect(result.elapsedTimeS).toBeGreaterThan(0);
    expect(result.averageSpeedMps).toBeCloseTo(fartlek.lengthMeters / result.elapsedTimeS!, 5);
  });

  it("completes on a full B->A (bidirectional) traversal", () => {
    const route = straightRoute(SEGMENT_LENGTH_METERS + 50, -50);
    const result = detectFartlekTraversal(route, fartlek);
    expect(result.completed).toBe(true);
    expect(result.direction).toBe("b_to_a");
  });

  it("completes identically slow as fast (speed never gates completion)", () => {
    const fast = detectFartlekTraversal(straightRoute(-50, SEGMENT_LENGTH_METERS + 50, { speedMps: 10 }), fartlek);
    const slow = detectFartlekTraversal(straightRoute(-50, SEGMENT_LENGTH_METERS + 50, { speedMps: 1 }), fartlek);
    expect(fast.completed).toBe(true);
    expect(slow.completed).toBe(true);
    expect(slow.elapsedTimeS!).toBeGreaterThan(fast.elapsedTimeS!);
  });

  it("tolerates GPS drift within the corridor buffer", () => {
    const route = straightRoute(-50, SEGMENT_LENGTH_METERS + 50, { lateralOffsetMeters: 10 });
    const result = detectFartlekTraversal(route, fartlek);
    expect(result.completed).toBe(true);
  });

  it("does not complete a partial traversal", () => {
    const route = straightRoute(0, SEGMENT_LENGTH_METERS / 2);
    const result = detectFartlekTraversal(route, fartlek);
    expect(result.completed).toBe(false);
  });

  it("does not complete when passing near but outside the corridor", () => {
    const route = straightRoute(-50, SEGMENT_LENGTH_METERS + 50, { lateralOffsetMeters: 80 });
    const result = detectFartlekTraversal(route, fartlek);
    expect(result.completed).toBe(false);
  });

  it("does not complete when touching only one gate", () => {
    const outAndBack = [
      ...straightRoute(-50, 200),
      ...straightRoute(200, -50).map((point) => ({ ...point, timestampMs: point.timestampMs + 300_000 }))
    ];
    const result = detectFartlekTraversal(outAndBack, fartlek);
    expect(result.completed).toBe(false);
  });

  it("does not complete when both ends are reached via a disconnected path (another road)", () => {
    // Near the start gate, jump far from the corridor, then appear near the end gate only.
    const route: TrackPoint[] = [
      { latitude: LAT, longitude: START_LON + lonOffset(-20), timestampMs: 0 },
      { latitude: LAT, longitude: START_LON + lonOffset(50), timestampMs: 10_000 },
      { latitude: LAT + latOffset(500), longitude: START_LON + lonOffset(SEGMENT_LENGTH_METERS / 2), timestampMs: 60_000 },
      { latitude: LAT, longitude: START_LON + lonOffset(SEGMENT_LENGTH_METERS - 50), timestampMs: 120_000 },
      { latitude: LAT, longitude: START_LON + lonOffset(SEGMENT_LENGTH_METERS + 20), timestampMs: 130_000 }
    ];
    const result = detectFartlekTraversal(route, fartlek);
    expect(result.completed).toBe(false);
  });

  it("returns no completion for an empty or trivial route", () => {
    expect(detectFartlekTraversal([], fartlek).completed).toBe(false);
    expect(detectFartlekTraversal([{ latitude: LAT, longitude: START_LON, timestampMs: 0 }], fartlek).completed).toBe(false);
  });
});

describe("deriveFartlekCompletionDrafts", () => {
  const published: Fartlek = { ...fartlek, status: "published" } as Fartlek;
  const archived: Fartlek = { ...fartlek, id: "fartlek-archived", status: "archived" } as Fartlek;

  it("produces one draft per completed published fartlek, carrying length/geometry snapshots", () => {
    const route = straightRoute(-50, SEGMENT_LENGTH_METERS + 50);
    const drafts = deriveFartlekCompletionDrafts(route, [published, archived]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      fartlekId: "fartlek-1",
      fartlekLengthMSnapshot: SEGMENT_LENGTH_METERS,
      fartlekGeometryVersionSnapshot: 1,
      traversalDirection: "a_to_b"
    });
  });

  it("produces no drafts when no fartlek is traversed", () => {
    const route = straightRoute(0, SEGMENT_LENGTH_METERS / 2);
    expect(deriveFartlekCompletionDrafts(route, [published])).toEqual([]);
  });
});
