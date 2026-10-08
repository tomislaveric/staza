import { describe, expect, it } from "vitest";
import { createActivityFingerprint, isHighConfidenceDuplicate } from "./activityFingerprint.js";
import type { ActivityType, TrackPoint } from "./domain.js";

const start = Date.parse("2026-05-01T08:00:00.000Z");
const route = (count = 120, offsetMs = 0, latitudeShift = 0, stepSeconds = 10): TrackPoint[] =>
  Array.from({ length: count }, (_, index) => ({
    latitude: 48.2 + index * 0.0005 + latitudeShift,
    longitude: 16.37 + index * 0.0003,
    timestampMs: start + offsetMs + index * stepSeconds * 1000
  }));
const fingerprint = (track: TrackPoint[], type: ActivityType = "cycling") => createActivityFingerprint({ type, route: track })!;

describe("activity fingerprint", () => {
  it("matches the same activity recorded with a different sampling and small clock offset", () => {
    const fit = fingerprint(route(), "unknown");
    const strava = fingerprint(route(120, 1_000).filter((_, index) => index % 2 === 0 || index === 119), "cycling");
    expect(isHighConfidenceDuplicate(fit, strava)).toBe(true);
  });

  it("rejects activities that differ in start time, route, distance, or type", () => {
    const base = fingerprint(route());
    expect(isHighConfidenceDuplicate(base, fingerprint(route(120, 10 * 60_000)))).toBe(false);
    expect(isHighConfidenceDuplicate(base, fingerprint(route(120, 0, 0.01)))).toBe(false);
    expect(isHighConfidenceDuplicate(base, fingerprint(route(60, 0, 0, 20)))).toBe(false);
    expect(isHighConfidenceDuplicate(base, fingerprint(route(), "running"))).toBe(false);
  });

  it("does not fingerprint tracks with fewer than two usable points", () => {
    expect(createActivityFingerprint({ type: "unknown", route: route(1) })).toBeUndefined();
  });
});
