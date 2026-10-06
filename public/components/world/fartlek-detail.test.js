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
    expect(markup).toContain("Complete the full segment in one activity.");
    expect(markup).not.toMatch(/as fast as possible/i);
    expect(markup).toContain("Not yet completed");
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
});
