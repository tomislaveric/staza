import { describe, expect, it } from "vitest";
import { AddActivityPage } from "./add-activity-page.js";
import { StravaImportSection, stravaErrorMessage } from "./strava-import.js";
import { appCopy } from "../app-locales.js";

const list = {
  limit: 10,
  journeyStartedAt: "2026-04-15T00:00:00.000Z",
  activities: [
    { id: "1", name: "<b>Morning</b> Ride", activityType: "cycling", startDate: "2026-05-01T08:00:00.000Z", distanceMeters: 12_300, hasRoute: true, beforeJourneyStart: false },
    { id: "2", name: "Old Ride", activityType: "cycling", startDate: "2026-04-01T08:00:00.000Z", hasRoute: true, beforeJourneyStart: true },
    { id: "3", name: "Imported", activityType: "running", hasRoute: true, beforeJourneyStart: false, importedActivityId: "staza-3" },
    { id: "4", name: "Treadmill", activityType: "running", hasRoute: false, beforeJourneyStart: false }
  ]
};

describe("StravaImportSection", () => {
  it("stays hidden while loading or when the integration is disabled", () => {
    expect(StravaImportSection({ status: "loading" })).toBe("");
    expect(StravaImportSection({ status: "disabled" })).toBe("");
    expect(AddActivityPage()).not.toContain("strava-import");
  });

  it("explains private activity access before connecting", () => {
    const view = StravaImportSection({ status: "disconnected" });
    expect(view).toContain("including private ones");
    expect(view).toContain('data-strava-action="connect"');
    expect(view).toContain("CONNECT STRAVA");
  });

  it("renders a single-choice list and disables ineligible activities", () => {
    const view = StravaImportSection({ status: "connected", list });
    expect(view.match(/type="radio" name="strava-activity"/g)).toHaveLength(4);
    expect(view.match(/ disabled/g)).toHaveLength(3);
    expect(view).toContain("Before your journey started");
    expect(view).toContain("Already imported");
    expect(view).toContain("No GPS route");
    expect(view).toContain("&lt;b&gt;Morning&lt;/b&gt; Ride");
    expect(view).not.toContain("<b>Morning</b>");
    expect(view).toContain("<strong data-user-content>");
    expect(view).toContain("IMPORT SELECTED ACTIVITY");
  });

  it("offers reconnect, empty, and duplicate states", () => {
    expect(StravaImportSection({ status: "reconnect_required" })).toContain("RECONNECT STRAVA");
    expect(StravaImportSection({ status: "connected", list: { ...list, activities: [] } })).toContain("No recent Strava activities found.");
    const duplicate = StravaImportSection({ status: "connected", error: { message: stravaErrorMessage("duplicate_activity"), existingActivityId: "staza-9" } });
    expect(duplicate).toContain("This activity is already in Staza.");
    expect(duplicate).toContain('data-strava-existing="staza-9"');
  });

  it("has German copy for every Strava message", () => {
    for (const code of ["duplicate_activity", "before_journey_start", "reconnect_required", "rate_limited", "invalid_streams", "unknown"]) {
      expect(appCopy.de[stravaErrorMessage(code)]).toBeTruthy();
    }
  });
});
