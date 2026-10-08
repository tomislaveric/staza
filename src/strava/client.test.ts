import { describe, expect, it, vi } from "vitest";
import { StravaClient, StravaRateGate } from "./client.js";

const settings = { clientId: "123", clientSecret: "client-secret", redirectUri: "https://staza.test/api/integrations/strava/callback" };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

describe("StravaClient", () => {
  it("builds an authorization URL with the exact redirect, scope, and state", () => {
    const url = new URL(new StravaClient(settings).authorizationUrl("state-value"));
    expect(url.origin + url.pathname).toBe("https://www.strava.com/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "123",
      redirect_uri: settings.redirectUri,
      response_type: "code",
      approval_prompt: "auto",
      scope: "activity:read_all",
      state: "state-value"
    });
  });

  it("exchanges a code server-side and returns tokens with the athlete id", async () => {
    const fetchImpl = vi.fn(async () => json({ access_token: "access", refresh_token: "refresh", expires_at: 1_800_000_000, athlete: { id: 42 } }));
    const result = await new StravaClient(settings, fetchImpl).exchangeCode("code");
    expect(result).toEqual({ accessToken: "access", refreshToken: "refresh", expiresAt: new Date(1_800_000_000_000), athleteId: 42 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://www.strava.com/oauth/token");
    expect(String(init.body)).toContain("client_secret=client-secret");
  });

  it("maps revoked refresh tokens to reconnect_required without echoing provider bodies", async () => {
    const client = new StravaClient(settings, async () => json({ message: "Bad Request token=abc" }, 400));
    const error = await client.refresh("refresh").catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "reconnect_required" });
    expect(String((error as Error).message)).not.toContain("token=abc");
  });

  it("requests only the first page of recent activities", async () => {
    const fetchImpl = vi.fn(async () => json([{ id: 1, name: "Ride" }, { id: "bad" }]));
    const activities = await new StravaClient(settings, fetchImpl).listRecentActivities("access", 10);
    expect(activities).toEqual([{ id: 1, name: "Ride" }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://www.strava.com/api/v3/athlete/activities?page=1&per_page=10");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer access");
  });

  it("requests only latlng and time streams and accepts both response shapes", async () => {
    const keyed = { latlng: { data: [[1, 2]] }, time: { data: [0] } };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json(keyed))
      .mockResolvedValueOnce(json([{ type: "latlng", data: [[1, 2]] }, { type: "time", data: [0] }]));
    const client = new StravaClient(settings, fetchImpl);
    expect(await client.getActivityStreams("access", "99")).toEqual(keyed);
    expect(await client.getActivityStreams("access", "99")).toEqual(keyed);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://www.strava.com/api/v3/activities/99/streams?keys=latlng%2Ctime&key_by_type=true");
  });

  it("maps API failures to safe error codes", async () => {
    const failing = (status: number) => new StravaClient(settings, async () => json({}, status)).listRecentActivities("access", 10);
    await expect(failing(401)).rejects.toMatchObject({ code: "reconnect_required" });
    await expect(failing(503)).rejects.toMatchObject({ code: "provider_unavailable" });
    await expect(new StravaClient(settings, async () => { throw new Error("socket"); }).listRecentActivities("access", 10))
      .rejects.toMatchObject({ code: "provider_unavailable" });
  });

  it("returns false instead of throwing when remote deauthorization fails", async () => {
    expect(await new StravaClient(settings, async () => json({}, 500)).deauthorize("access")).toBe(false);
    expect(await new StravaClient(settings, async () => json({})).deauthorize("access")).toBe(true);
  });
});

describe("StravaRateGate", () => {
  it("blocks requests until Retry-After passes after a 429", async () => {
    let now = Date.parse("2026-05-01T08:01:00Z");
    const gate = new StravaRateGate(() => now);
    const fetchImpl = vi.fn(async () => json({}, 429, { "Retry-After": "30" }));
    const client = new StravaClient(settings, fetchImpl, gate);
    await expect(client.listRecentActivities("access", 10)).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 30 });
    await expect(client.listRecentActivities("access", 10)).rejects.toMatchObject({ code: "rate_limited" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now += 31_000;
    expect(() => gate.assertAvailable()).not.toThrow();
  });

  it("stops at exhausted 15-minute and daily read limits", () => {
    let now = Date.parse("2026-05-01T08:01:00Z");
    const gate = new StravaRateGate(() => now);
    gate.record(200, new Headers({ "X-ReadRateLimit-Limit": "100,1000", "X-ReadRateLimit-Usage": "100,200" }));
    expect(() => gate.assertAvailable()).toThrow();
    now = Date.parse("2026-05-01T08:15:00Z");
    expect(() => gate.assertAvailable()).not.toThrow();
    gate.record(200, new Headers({ "X-RateLimit-Limit": "200,2000", "X-RateLimit-Usage": "10,2000" }));
    now = Date.parse("2026-05-01T23:59:00Z");
    expect(() => gate.assertAvailable()).toThrow();
    now = Date.parse("2026-05-02T00:00:00Z");
    expect(() => gate.assertAvailable()).not.toThrow();
  });
});
