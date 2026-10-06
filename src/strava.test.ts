import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasRequiredStravaScopes,
  createStravaAuthorizationUrl,
  mapStravaSportType,
  normalizeStravaActivity,
  normalizeStravaStreams,
  StravaApiError,
  stravaJson
} from "./strava.js";

afterEach(() => vi.unstubAllGlobals());

describe("Strava normalization", () => {
  it("builds an authorization URL with the exact callback, minimal scopes, and supplied state", () => {
    const url = new URL(createStravaAuthorizationUrl(
      "client-id",
      "https://staza.example/api/integrations/strava/callback",
      "random-state"
    ));
    expect(url.origin + url.pathname).toBe("https://www.strava.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("https://staza.example/api/integrations/strava/callback");
    expect(url.searchParams.get("scope")).toBe("read,activity:read_all");
    expect(url.searchParams.get("state")).toBe("random-state");
  });

  it.each([
    ["Ride", "cycling"],
    ["GravelRide", "cycling"],
    ["MountainBikeRide", "cycling"],
    ["EBikeRide", "cycling"],
    ["Run", "running"],
    ["TrailRun", "running"],
    ["Hike", "hiking"],
    ["Walk", "walking"]
  ])("maps supported sport type %s to %s", (sport, type) => {
    expect(mapStravaSportType(sport)).toBe(type);
  });

  it("excludes unsupported sports and requires both read scopes", () => {
    expect(mapStravaSportType("VirtualRide")).toBeUndefined();
    expect(normalizeStravaActivity({
      id: 12345,
      name: "Virtual ride",
      sport_type: "VirtualRide",
      start_date: "2026-06-01T08:00:00Z",
      distance: 12000,
      moving_time: 3600,
      total_elevation_gain: 230
    })).toBeUndefined();
    expect(hasRequiredStravaScopes("read,activity:read_all")).toBe(true);
    expect(hasRequiredStravaScopes("read,activity:read")).toBe(false);
  });

  it("normalizes only supported recent activities", () => {
    expect(normalizeStravaActivity({
      id: 12345,
      name: "Morning ride",
      sport_type: "GravelRide",
      start_date: "2026-06-01T08:00:00Z",
      distance: 12000,
      moving_time: 3600,
      total_elevation_gain: 230
    })).toMatchObject({
      externalId: "12345",
      type: "cycling",
      startedAt: "2026-06-01T08:00:00.000Z",
      distance: 12000,
      duration: 3600,
      elevationGain: 230
    });
  });

  it("zips GPS and elapsed-time streams into canonical track points", () => {
    expect(normalizeStravaStreams(
      "2026-06-01T08:00:00Z",
      [[52.5, 13.4], [52.5001, 13.4001]],
      [0, 5]
    )).toEqual([
      { latitude: 52.5, longitude: 13.4, timestampMs: Date.parse("2026-06-01T08:00:00Z") },
      { latitude: 52.5001, longitude: 13.4001, timestampMs: Date.parse("2026-06-01T08:00:05Z") }
    ]);
    expect(() => normalizeStravaStreams("2026-06-01T08:00:00Z", [[0, 0]], [0]))
      .toThrow("usable GPS track");
    expect(() => normalizeStravaStreams("2026-06-01T08:00:00Z", [[91, 0], [0, 0]], [0, 1]))
      .toThrow("invalid GPS coordinates");
  });
});

describe("Strava HTTP errors", () => {
  it("distinguishes an inactive developer application from a failed authorization", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: "Forbidden",
      errors: [{ resource: "Application", field: "Status", code: "Inactive" }],
      access_token: "must-not-be-exposed"
    }), { status: 403 })));
    await expect(stravaJson("https://strava.invalid")).rejects.toMatchObject({
      status: 403,
      code: "STRAVA_APPLICATION_INACTIVE",
      message: "Strava authorization succeeded, but the Strava developer application is inactive. Check its status in Strava API settings; reconnecting will not fix this."
    });
  });

  it.each([
    JSON.stringify({ errors: [{ resource: "Activity", field: "permission", code: "missing" }] }),
    "non-JSON private provider response",
    "null"
  ])("handles other forbidden responses without exposing provider payloads", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 403 })));
    await expect(stravaJson("https://strava.invalid")).rejects.toMatchObject({
      status: 403,
      code: "STRAVA_ACCESS_DENIED",
      message: "Strava denied access to this request."
    });
  });

  it("returns a user-facing rate limit error without exposing raw provider responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private response", { status: 429 })));
    await expect(stravaJson("https://strava.invalid")).rejects.toMatchObject({
      status: 429,
      message: "Strava is receiving too many requests. Try again shortly.",
      code: "STRAVA_RATE_LIMITED"
    } satisfies Partial<StravaApiError>);
  });
});
