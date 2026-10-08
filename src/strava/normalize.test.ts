import { describe, expect, it } from "vitest";
import { mapStravaSportType, normalizeStravaActivity, normalizeStravaTrack } from "./normalize.js";

describe("Strava normalization", () => {
  it("maps sport types onto Staza activity types", () => {
    expect(mapStravaSportType("GravelRide")).toBe("cycling");
    expect(mapStravaSportType("TrailRun")).toBe("running");
    expect(mapStravaSportType("Hike")).toBe("hiking");
    expect(mapStravaSportType("Walk")).toBe("walking");
    expect(mapStravaSportType(undefined, "Ride")).toBe("cycling");
    expect(mapStravaSportType("Swim")).toBe("unknown");
  });

  it("converts relative streams into absolute UTC points and drops invalid samples", () => {
    const track = normalizeStravaTrack("2026-05-01T08:00:00Z", {
      latlng: { data: [[48.2, 16.3], [0, 0], [48.3, 16.4], [91, 10], [48.4, 16.5], [48.5, 16.6]] },
      time: { data: [0, 5, 10, 15, 10, 20] }
    });
    const start = Date.parse("2026-05-01T08:00:00Z");
    expect(track).toEqual([
      { latitude: 48.2, longitude: 16.3, timestampMs: start },
      { latitude: 48.3, longitude: 16.4, timestampMs: start + 10_000 },
      { latitude: 48.5, longitude: 16.6, timestampMs: start + 20_000 }
    ]);
  });

  it("rejects missing or unusable streams", () => {
    expect(() => normalizeStravaTrack("2026-05-01T08:00:00Z", { time: { data: [0, 1] } })).toThrow(expect.objectContaining({ code: "invalid_streams" }));
    expect(() => normalizeStravaTrack("2026-05-01T08:00:00Z", { latlng: { data: [[48.2, 16.3]] }, time: { data: [0] } }))
      .toThrow(expect.objectContaining({ code: "invalid_streams" }));
    expect(() => normalizeStravaTrack(undefined, { latlng: { data: [[48.2, 16.3], [48.3, 16.4]] }, time: { data: [0, 1] } }))
      .toThrow(expect.objectContaining({ code: "invalid_streams" }));
  });

  it("derives a canonical Strava activity", () => {
    const activity = normalizeStravaActivity("activity-1", { id: 1, name: " Morning Ride ", sport_type: "Ride", start_date: "2026-05-01T08:00:00Z" }, {
      latlng: { data: [[48.2, 16.3], [48.21, 16.31]] },
      time: { data: [0, 60] }
    });
    expect(activity).toMatchObject({ id: "activity-1", source: "strava", type: "cycling", title: "Morning Ride", duration: 60 });
    expect(activity.distance).toBeGreaterThan(1000);
  });
});
