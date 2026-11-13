import { describe, expect, it, vi } from "vitest";
import type { ActivityResult, PersistedActivity } from "../domain.js";
import { StravaError } from "./errors.js";
import { StravaService } from "./service.js";

const summary = {
  id: 1001,
  name: "Morning Ride",
  sport_type: "Ride",
  start_date: "2026-05-01T08:00:00Z",
  distance: 1500,
  moving_time: 300,
  map: { summary_polyline: "abc" }
};
const streams = { latlng: { data: [[48.2, 16.3], [48.21, 16.31]] }, time: { data: [0, 300] } };
const result = { activityId: "x", collectedCount: 0, totalPoints: 0, events: [] } as unknown as ActivityResult;

const setup = () => {
  const client = {
    authorizationUrl: vi.fn((state: string) => `https://strava.test/authorize?state=${state}`),
    exchangeCode: vi.fn(async () => ({ accessToken: "a", refreshToken: "r", expiresAt: new Date(), athleteId: 7 })),
    refresh: vi.fn(),
    deauthorize: vi.fn(async () => true),
    listRecentActivities: vi.fn(async () => [summary, { id: 1002, name: "Treadmill", manual: true, start_date: "2026-04-01T08:00:00Z" }]),
    getActivityStreams: vi.fn(async () => streams)
  };
  const connections = {
    createOAuthState: vi.fn(async () => "state"),
    consumeOAuthState: vi.fn(async () => ({ locale: "de" as const })),
    isPendingNativeOAuthState: vi.fn(async () => true),
    consumeNativeOAuthState: vi.fn(async (): Promise<{ locale: "de" } | undefined> => ({ locale: "de" })),
    saveConnection: vi.fn(async () => undefined),
    getStatus: vi.fn(async () => ({ status: "connected" as const })),
    getAccessToken: vi.fn(async () => "access"),
    markReconnectRequired: vi.fn(async () => undefined),
    deleteConnection: vi.fn(async () => ({ accessToken: "access" }))
  };
  const activities = {
    getActivityByImportKey: vi.fn(async (): Promise<PersistedActivity | undefined> => undefined),
    listActivityIdsByImportKeys: vi.fn(async () => new Map([["1001", "staza-1"]])),
    getJourneyStartedAt: vi.fn(async (): Promise<Date | undefined> => new Date("2026-04-15T00:00:00Z")),
    getActivityCount: vi.fn(async () => 0),
    persistCompletedActivity: vi.fn(async (_player: string, activity: { id: string }) => ({
      activity: { id: activity.id } as PersistedActivity,
      inserted: true
    }))
  };
  const process = vi.fn(async () => ({ result, totalCollectibles: 0, relevantCollectibles: 0 }));
  const service = new StravaService(client as never, connections as never, activities as never, process, 3);
  return { client, connections, activities, process, service };
};

describe("StravaService authorization", () => {
  const user = { playerId: "player", sessionId: "session" };

  it("rejects callbacks without a matching session-bound state before exchanging a code", async () => {
    const { service, client, connections } = setup();
    expect(await service.completeAuthorization(undefined, { state: "s", code: "c", scope: "read,activity:read_all" })).toEqual({ outcome: "invalid_state", locale: "en" });
    connections.consumeOAuthState.mockResolvedValueOnce(undefined as never);
    expect((await service.completeAuthorization(user, { state: "s", code: "c", scope: "read,activity:read_all" })).outcome).toBe("invalid_state");
    expect(client.exchangeCode).not.toHaveBeenCalled();
  });

  it("handles denial and a missing activity:read_all scope without storing tokens", async () => {
    const { service, connections } = setup();
    expect(await service.completeAuthorization(user, { state: "s", error: "access_denied" })).toEqual({ outcome: "denied", locale: "de" });
    expect((await service.completeAuthorization(user, { state: "s", code: "c", scope: "read,activity:read" })).outcome).toBe("missing_scope");
    expect(connections.saveConnection).not.toHaveBeenCalled();
  });

  it("stores the connection after a valid callback", async () => {
    const { service, connections } = setup();
    expect(await service.completeAuthorization(user, { state: "s", code: "c", scope: "read,activity:read_all" })).toEqual({ outcome: "connected", locale: "de" });
    expect(connections.saveConnection).toHaveBeenCalledWith("player", expect.objectContaining({ athleteId: 7 }), "activity:read_all");
  });

  it("hands a native callback's code back to the app without exchanging it", async () => {
    const { service, client, connections } = setup();
    const redirect = await service.nativeCallbackRedirect({ state: "s/+", code: "c", scope: "read,activity:read_all" });
    expect(redirect).toBe("staza://strava?code=c&state=s%2F%2B&scope=read%2Cactivity%3Aread_all");
    expect(connections.isPendingNativeOAuthState).toHaveBeenCalledWith("s/+");
    expect(connections.consumeNativeOAuthState).not.toHaveBeenCalled();
    expect(client.exchangeCode).not.toHaveBeenCalled();
  });

  it("redirects denied, missing-scope and malformed native callbacks with an outcome only", async () => {
    const { service, client } = setup();
    expect(await service.nativeCallbackRedirect({ state: "s", error: "access_denied" })).toBe("staza://strava?outcome=denied");
    expect(await service.nativeCallbackRedirect({ state: "s", code: "c", scope: "read,activity:read" })).toBe("staza://strava?outcome=missing_scope");
    expect(await service.nativeCallbackRedirect({ state: "s", scope: "activity:read_all" })).toBe("staza://strava?outcome=error");
    expect(client.exchangeCode).not.toHaveBeenCalled();
  });

  it("leaves non-native or unknown states to the web callback", async () => {
    const { service, connections } = setup();
    expect(await service.nativeCallbackRedirect({ code: "c" })).toBeUndefined();
    connections.isPendingNativeOAuthState.mockResolvedValueOnce(false);
    expect(await service.nativeCallbackRedirect({ state: "s", code: "c", scope: "activity:read_all" })).toBeUndefined();
  });

  it("completes a native authorization only for the player and session that started it", async () => {
    const { service, client, connections } = setup();
    expect(await service.completeNativeAuthorization(user, { state: "s", code: "c", scope: "read,activity:read_all" })).toEqual({ outcome: "connected" });
    expect(connections.consumeNativeOAuthState).toHaveBeenCalledWith("s", "player", "session");
    expect(connections.saveConnection).toHaveBeenCalledWith("player", expect.anything(), "activity:read_all");

    connections.consumeNativeOAuthState.mockResolvedValueOnce(undefined);
    const other = { playerId: "victim", sessionId: "victim-session" };
    expect(await service.completeNativeAuthorization(other, { state: "s", code: "c", scope: "activity:read_all" })).toEqual({ outcome: "invalid_state" });
    expect(await service.completeNativeAuthorization(user, { code: "c", scope: "activity:read_all" })).toEqual({ outcome: "invalid_state" });
    expect(client.exchangeCode).toHaveBeenCalledTimes(1);
  });

  it("reports native denial and missing scope without storing tokens", async () => {
    const { service, connections } = setup();
    expect(await service.completeNativeAuthorization(user, { state: "s", error: "access_denied" })).toEqual({ outcome: "denied" });
    expect(await service.completeNativeAuthorization(user, { state: "s", code: "c", scope: "read" })).toEqual({ outcome: "missing_scope" });
    expect(connections.saveConnection).not.toHaveBeenCalled();
  });
});

describe("StravaService activities", () => {
  it("lists a safe recent-activity view of GPS activities only", async () => {
    const { service, client } = setup();
    const list = await service.listRecent("player");
    expect(client.listRecentActivities).toHaveBeenCalledWith("access", 30);
    expect(list).toEqual({
      limit: 3,
      journeyStartedAt: "2026-04-15T00:00:00.000Z",
      activities: [
        expect.objectContaining({ id: "1001", importedActivityId: "staza-1", hasRoute: true, beforeJourneyStart: false, activityType: "cycling" })
      ]
    });
  });

  it("shows only the newest configured number of GPS activities from one page", async () => {
    const { service, client } = setup();
    const gps = (id: number) => ({ ...summary, id });
    client.listRecentActivities.mockResolvedValueOnce([
      { id: 2001, name: "Indoor", manual: false, start_date: "2026-04-20T08:00:00Z" },
      gps(2002), { id: 2003, name: "Manual", manual: true, start_latlng: [48, 16] }, gps(2004), gps(2005), gps(2006)
    ] as never);
    const list = await service.listRecent("player");
    expect(list.activities.map((activity) => activity.id)).toEqual(["2002", "2004", "2005"]);
    expect(client.listRecentActivities).toHaveBeenCalledTimes(1);
  });

  it("allows pre-account Strava activities during the first three imports only", async () => {
    const { service, activities } = setup();
    activities.getJourneyStartedAt.mockResolvedValue(new Date("2026-05-15T00:00:00Z"));
    activities.getActivityCount.mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    const onboardingList = await service.listRecent("player");
    const regularList = await service.listRecent("player");
    expect(onboardingList.activities[0].beforeJourneyStart).toBe(false);
    expect(regularList.activities[0].beforeJourneyStart).toBe(true);
  });

  it("lists up to the configured limit and never flags pre-account activities when the cutoff is ignored", async () => {
    const { client, connections, activities, process } = setup();
    const service = new StravaService(client as never, connections as never, activities as never, process, 30, true);
    activities.getJourneyStartedAt.mockResolvedValue(new Date("2026-05-15T00:00:00Z"));
    activities.getActivityCount.mockResolvedValue(10);
    client.listRecentActivities.mockResolvedValueOnce(Array.from({ length: 30 }, (_, index) => ({ ...summary, id: 3000 + index })) as never);
    const list = await service.listRecent("player");
    expect(list.activities).toHaveLength(30);
    expect(list.activities.every((activity) => !activity.beforeJourneyStart)).toBe(true);
  });

  it("returns an existing import without calling Strava", async () => {
    const { service, client, activities } = setup();
    activities.getActivityByImportKey.mockResolvedValueOnce({ id: "staza-1" } as PersistedActivity);
    expect(await service.importActivity("player", "1001")).toEqual({ activity: { id: "staza-1" }, inserted: false });
    expect(client.listRecentActivities).not.toHaveBeenCalled();
    expect(client.getActivityStreams).not.toHaveBeenCalled();
  });

  it("imports exactly one listed activity through the canonical processor and transaction", async () => {
    const { service, client, activities, process } = setup();
    const imported = await service.importActivity("player", "1001");
    expect(imported.inserted).toBe(true);
    expect(client.getActivityStreams).toHaveBeenCalledTimes(1);
    expect(client.getActivityStreams).toHaveBeenCalledWith("access", "1001");
    expect(process).toHaveBeenCalledWith(expect.objectContaining({ source: "strava", type: "cycling" }));
    expect(activities.persistCompletedActivity).toHaveBeenCalledWith("player", expect.objectContaining({ source: "strava" }), result, "1001");
  });

  it("refuses ids outside the recent list, malformed ids, and activities without a route", async () => {
    const { service, client } = setup();
    await expect(service.importActivity("player", "../1")).rejects.toMatchObject({ code: "invalid_activity_id" });
    await expect(service.importActivity("player", "9999")).rejects.toMatchObject({ code: "activity_not_found" });
    await expect(service.importActivity("player", "1002")).rejects.toMatchObject({ code: "activity_not_found" });
    expect(client.getActivityStreams).not.toHaveBeenCalled();
  });

  it("marks the connection for reconnect when Strava rejects the access token", async () => {
    const { service, client, connections } = setup();
    client.listRecentActivities.mockRejectedValueOnce(new StravaError("reconnect_required"));
    await expect(service.listRecent("player")).rejects.toMatchObject({ code: "reconnect_required" });
    expect(connections.markReconnectRequired).toHaveBeenCalledWith("player");
  });

  it("disconnects locally and reports remote revocation", async () => {
    const { service, client } = setup();
    client.deauthorize.mockResolvedValueOnce(false);
    expect(await service.disconnect("player")).toEqual({ disconnected: true, remoteRevoked: false });
  });
});
