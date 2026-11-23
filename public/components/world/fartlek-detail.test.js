import { describe, expect, it } from "vitest";
import { FartlekDetail, formatElapsed, formatSpeed } from "./fartlek-detail.js";

const fartlek = (overrides = {}) => ({
  id: "fartlek-1",
  name: "Harbour Straight",
  geometry: { type: "LineString", coordinates: [[8.4, 49.1], [8.42, 49.12]] },
  lengthMeters: 3_200,
  status: "published",
  source: { sourceType: "osm", sourceExternalId: "way:1" },
  completed: false,
  completionCount: 0,
  ...overrides
});

describe("formatElapsed", () => {
  it("formats under-an-hour durations as mm:ss", () => {
    expect(formatElapsed(65)).toBe("1:05");
    expect(formatElapsed(600)).toBe("10:00");
  });

  it("formats hour-or-longer durations as h:mm:ss", () => {
    expect(formatElapsed(3_725)).toBe("1:02:05");
  });
});

describe("formatSpeed", () => {
  it("converts m/s to km/h with one decimal", () => {
    expect(formatSpeed(5)).toBe("18.0 km/h");
  });
});

describe("FartlekDetail", () => {
  it("never implies a speed target when uncompleted", () => {
    const markup = FartlekDetail(fartlek());
    expect(markup).toContain('aria-label="Flowline detail"');
    expect(markup).toContain('aria-label="Close Flowline detail"');
    expect(markup).toContain("Complete the full segment in one activity.");
    expect(markup).not.toMatch(/as fast as possible/i);
    expect(markup).toContain("Unridden");
  });

  it("shows latest time, average speed, best time and completion count once completed", () => {
    const markup = FartlekDetail(fartlek({
      completed: true,
      completionCount: 3,
      bestElapsedTimeS: 600,
      latestCompletion: { completedAt: "2026-01-01T00:00:00.000Z", elapsedTimeS: 650, averageSpeedMps: 5 }
    }));
    expect(markup).toContain("Completed");
    expect(markup).toContain("10:50");
    expect(markup).toContain("18.0 km/h");
    expect(markup).toContain("10:00");
    expect(markup).toContain(">3<");
  });

  it("highlights the primary character with at most two scores and offers Add to route", () => {
    const markup = FartlekDetail(fartlek({
      flowScore: 84, enduranceScore: 70, exploreScore: 60, roadQualityScore: 91,
      character: { primary: "flow", tags: ["flow", "endurance"] }
    }));
    expect(markup).toContain("High-flow");
    expect(markup).toMatch(/<dt>Flow<\/dt><dd>84<\/dd>/);
    expect(markup).toMatch(/<dt>Road quality<\/dt><dd>91<\/dd>/);
    expect(markup).not.toContain("<dt>Endurance</dt>");
    expect(markup).not.toContain("Best for");
    expect(markup).toContain('data-flowline-add-route="');
    expect(markup).toContain(">Add to route<");
    expect(markup).toContain("View details");
    expect(FartlekDetail(fartlek(), { inRoute: true })).toContain(">Added to route<");
    expect(FartlekDetail(fartlek({ character: { primary: "flow", tags: ["flow"] } }))).not.toContain("Best for");
  });

  it("shows a plain Flowline without inventing a specialist score", () => {
    const markup = FartlekDetail(fartlek({
      flowScore: 82, enduranceScore: 90, exploreScore: 64, roadQualityScore: 91,
      character: { primary: null, tags: [], policyVersion: 2 }
    }));
    expect(markup).toContain('is-plain">Flowline</span>');
    expect(markup).toContain("<dt>Length</dt>");
    expect(markup).toContain("<dt>Road quality</dt>");
    expect(markup).not.toMatch(/<dt>(Flow|Endurance|Explore)<\/dt>/);
    expect(markup).not.toContain("undefined");
  });
});
