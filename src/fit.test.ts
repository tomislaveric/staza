import { describe, expect, it } from "vitest";
import { extractFitMetadata, mapFitSport, usableFitTrackPoints } from "./fit.js";
import { SynchronizationError } from "./synchronization.js";

describe("FIT metadata extraction", () => {
  it("reads a reliable title and description from named FIT messages", () => {
    const metadata = extractFitMetadata({
      workout: { wkt_name: "Morning Loop", notes: "Ridge and back" }
    });
    expect(metadata).toEqual({ title: "Morning Loop", description: "Ridge and back", activityType: "unknown" });
  });

  it("falls back to a session sport profile name when no workout name exists", () => {
    const metadata = extractFitMetadata({ sessions: [{ sport_profile_name: "Road Cycling" }] });
    expect(metadata).toEqual({ title: "Road Cycling", activityType: "unknown" });
  });

  it("omits blank or missing name fields", () => {
    expect(extractFitMetadata({ workout: { wkt_name: "   " }, session: { notes: "" } })).toEqual({ activityType: "unknown" });
    expect(extractFitMetadata({})).toEqual({ activityType: "unknown" });
  });
});

describe("FIT timestamp validation", () => {
  it("reports an explicit typed error for insufficient usable timestamps", () => {
    try {
      usableFitTrackPoints([{ position_lat: 1, position_long: 2, timestamp: "invalid" }]);
      throw new Error("Expected usableFitTrackPoints to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(SynchronizationError);
      expect((error as SynchronizationError).code).toBe("INVALID_FIT_TIMESTAMPS");
    }
  });
});

describe("FIT coordinate validation", () => {
  it("drops non-finite and out-of-range coordinates before counting usable points", () => {
    const at = (n: number) => `2026-01-01T00:00:0${n}Z`;
    const good = [
      { position_lat: 1, position_long: 2, timestamp: at(0) },
      { position_lat: 1.1, position_long: 2.1, timestamp: at(1) }
    ];
    const bad = [
      { position_lat: Number.NaN, position_long: 2, timestamp: at(2) },
      { position_lat: 1, position_long: Number.POSITIVE_INFINITY, timestamp: at(3) },
      { position_lat: 91, position_long: 2, timestamp: at(4) },
      { position_lat: 1, position_long: 181, timestamp: at(5) }
    ];
    expect(usableFitTrackPoints([...good, ...bad])).toHaveLength(2);
    expect(() => usableFitTrackPoints([good[0], ...bad])).toThrow();
  });
});

describe("FIT sport mapping", () => {
  it("maps supported sports and sub-sports, keeping unrecognized values unknown", () => {
    expect(mapFitSport("cycling", "road")).toBe("cycling");
    expect(mapFitSport("e_biking")).toBe("cycling");
    expect(mapFitSport("running", "trail")).toBe("running");
    expect(mapFitSport("Hiking")).toBe("hiking");
    expect(mapFitSport("generic", "hiking")).toBe("hiking");
    expect(mapFitSport("swimming", "lap_swimming")).toBe("unknown");
    expect(mapFitSport(undefined)).toBe("unknown");
  });

  it("reads the sport from the session or the sport message", () => {
    expect(extractFitMetadata({ sessions: [{ sport: "cycling" }] }).activityType).toBe("cycling");
    expect(extractFitMetadata({ sports: [{ sport: "running" }] }).activityType).toBe("running");
  });
});
