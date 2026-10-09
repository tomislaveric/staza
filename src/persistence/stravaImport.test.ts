import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveActivity } from "../activity.js";
import type { ActivityResult, ActivitySource, TrackPoint } from "../domain.js";
import { StravaError } from "../strava/errors.js";
import { TokenCipher } from "../strava/tokenCipher.js";
import { ActivityRepository } from "./activityRepository.js";
import { createDatabasePool } from "./database.js";
import { migrate } from "./migrate.js";
import { backfillActivityFingerprints } from "./migrations.js";
import { StravaConnectionRepository } from "./stravaConnectionRepository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describePersistence = databaseUrl ? describe : describe.skip;
const pool = databaseUrl ? createDatabasePool(databaseUrl) : undefined;
const activities = pool ? new ActivityRepository(pool) : undefined;
const connections = pool ? new StravaConnectionRepository(pool, new TokenCipher(randomBytes(32))) : undefined;
const playerId = "00000000-0000-4000-8000-000000000123";
const userId = "00000000-0000-4000-8000-000000000124";
const sessionId = "00000000-0000-4000-8000-000000000125";

const track = (startIso: string, latitudeShift = 0): TrackPoint[] => Array.from({ length: 60 }, (_, index) => ({
  latitude: 48.2 + index * 0.0005 + latitudeShift,
  longitude: 16.37 + index * 0.0003,
  timestampMs: Date.parse(startIso) + index * 10_000
}));
const activity = (startIso: string, source: ActivitySource = "fit", latitudeShift = 0) =>
  deriveActivity(randomUUID(), track(startIso, latitudeShift), source === "strava" ? "cycling" : "unknown", {}, source);
const result = (activityId: string, xp = 10): ActivityResult => ({
  activityId,
  distance: 0,
  duration: 0,
  collectedCount: 0,
  totalPoints: xp,
  distanceXp: 0,
  distanceXpRewards: [],
  collectibles: [],
  events: [],
  nearMisses: [],
  fartlekCompletions: []
});
const persist = (item: ReturnType<typeof activity>, key: string | undefined = undefined, xp = 10) =>
  activities!.persistCompletedActivity(playerId, item, result(item.id, xp), key);
const playerState = async () => (await pool!.query<{ total_xp: number; journey_started_at: Date | null; count: string }>(
  `SELECT p.total_xp, p.journey_started_at, (SELECT count(*) FROM activities a WHERE a.player_id = p.id) AS count
   FROM players p WHERE p.id = $1`, [playerId])).rows[0];

if (pool) {
  beforeEach(async () => {
    await migrate(pool!);
    await pool!.query("TRUNCATE strava_oauth_states, strava_connections, activity_events, activities, sessions, players, users CASCADE");
    await pool!.query("INSERT INTO users (id, email) VALUES ($1, 'strava@example.com')", [userId]);
    await pool!.query("INSERT INTO players (id, display_name, user_id) VALUES ($1, 'Strava player', $2)", [playerId, userId]);
    await pool!.query(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at, absolute_expires_at)
       VALUES ($1, $2, 'hash', 'csrf', now() + interval '1 day', now() + interval '1 day')`,
      [sessionId, userId]
    );
  });

  afterAll(async () => {
    await pool?.end();
  });
}

describePersistence("Strava import persistence", () => {
  it("allows earlier Strava activities among the first three imports, then preserves the journey boundary", async () => {
    await persist(activity("2026-05-10T08:00:00Z"));
    expect((await playerState()).journey_started_at?.toISOString()).toBe("2026-05-10T08:00:00.000Z");

    await persist(activity("2026-05-09T08:00:00Z", "strava"), "2001");
    expect((await playerState()).journey_started_at?.toISOString()).toBe("2026-05-09T08:00:00.000Z");

    await persist(activity("2026-05-08T08:00:00Z", "strava", 0.05), "2002");
    await expect(persist(activity("2026-05-07T08:00:00Z", "strava"), "2003"))
      .rejects.toMatchObject({ code: "before_journey_start", details: { journeyStartedAt: "2026-05-08T08:00:00.000Z" } });
    expect(await playerState()).toMatchObject({ total_xp: 30, count: "3" });
    expect((await playerState()).journey_started_at?.toISOString()).toBe("2026-05-08T08:00:00.000Z");

    await persist(activity("2026-05-10T08:00:00Z", "strava"), "2004");
    expect(await playerState()).toMatchObject({ total_xp: 40, count: "4" });
  });

  it("backfills fingerprints for existing activities so they participate in duplicate checks", async () => {
    const fit = await persist(activity("2026-05-10T08:00:00Z"));
    await pool!.query("UPDATE activities SET fingerprint = NULL, fingerprint_version = NULL, fingerprint_started_at = NULL");
    const client = await pool!.connect();
    try { await backfillActivityFingerprints(client); } finally { client.release(); }
    const row = (await pool!.query("SELECT fingerprint_version, fingerprint_started_at FROM activities WHERE id = $1", [fit.activity.id])).rows[0];
    expect(row).toMatchObject({ fingerprint_version: 1, fingerprint_started_at: new Date("2026-05-10T08:00:00Z") });
    await expect(persist(activity("2026-05-10T08:00:00Z", "strava"), "3002")).rejects.toMatchObject({ code: "duplicate_activity" });
  });

  it("rejects a high-confidence cross-source duplicate and points to the existing activity", async () => {
    const fit = await persist(activity("2026-05-10T08:00:00Z"));
    await expect(persist(activity("2026-05-10T08:00:30Z", "strava"), "3001"))
      .rejects.toMatchObject({ code: "duplicate_activity", details: { existingActivityId: fit.activity.id } });
    expect(await playerState()).toMatchObject({ total_xp: 10, count: "1" });
  });

  it("returns the same Strava activity once even when imported concurrently", async () => {
    const results = await Promise.all([
      persist(activity("2026-05-10T08:00:00Z", "strava"), "4001"),
      persist(activity("2026-05-10T08:00:00Z", "strava"), "4001")
    ]);
    expect(results.map((item) => item.inserted).sort()).toEqual([false, true]);
    expect(results[0].activity.id).toBe(results[1].activity.id);
    expect(await playerState()).toMatchObject({ total_xp: 10, count: "1" });
    expect((await activities!.getActivityByImportKey(playerId, "4001", "strava"))?.id).toBe(results[0].activity.id);
    expect(await activities!.getActivityByImportKey(playerId, "4001", "fit")).toBeUndefined();
  });

  it("establishes exactly one journey boundary for concurrent first imports", async () => {
    const outcomes = await Promise.allSettled([
      persist(activity("2026-05-12T08:00:00Z")),
      persist(activity("2026-05-11T08:00:00Z", "strava", 0.05), "5001")
    ]);
    const state = await playerState();
    const accepted = outcomes.filter((outcome) => outcome.status === "fulfilled");
    expect(accepted.length).toBeGreaterThanOrEqual(1);
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") expect(outcome.reason).toMatchObject({ code: "before_journey_start" });
    }
    const starts = (await pool!.query<{ started_at: Date }>("SELECT started_at FROM activities WHERE player_id = $1", [playerId])).rows;
    expect(starts.every((row) => row.started_at.getTime() >= state.journey_started_at!.getTime())).toBe(true);
    expect(state.total_xp).toBe(accepted.length * 10);
  });
});

describePersistence("StravaConnectionRepository", () => {
  const authorization = { accessToken: "access-1", refreshToken: "refresh-1", expiresAt: new Date(Date.now() + 3_600_000), athleteId: 77 };

  it("binds OAuth state to the player and session and consumes it once", async () => {
    const state = await connections!.createOAuthState(playerId, sessionId, "de");
    expect(await connections!.consumeOAuthState(state, playerId, randomUUID())).toBeUndefined();
    expect(await connections!.consumeOAuthState(state, playerId, sessionId)).toEqual({ locale: "de" });
    expect(await connections!.consumeOAuthState(state, playerId, sessionId)).toBeUndefined();
    const stored = await pool!.query("SELECT state_hash FROM strava_oauth_states");
    expect(JSON.stringify(stored.rows)).not.toContain(state);
  });

  it("rejects expired OAuth state", async () => {
    const state = await connections!.createOAuthState(playerId, sessionId, "en");
    await pool!.query("UPDATE strava_oauth_states SET expires_at = now() - interval '1 second'");
    expect(await connections!.consumeOAuthState(state, playerId, sessionId)).toBeUndefined();
  });

  it("stores tokens encrypted and exposes only safe status", async () => {
    await connections!.saveConnection(playerId, authorization, "activity:read_all");
    const raw = JSON.stringify((await pool!.query("SELECT * FROM strava_connections")).rows);
    expect(raw).not.toContain("access-1");
    expect(raw).not.toContain("refresh-1");
    const status = await connections!.getStatus(playerId);
    expect(status).toEqual({ status: "connected", connectedAt: expect.any(String) });
    expect(await connections!.getAccessToken(playerId, vi.fn())).toBe("access-1");
  });

  it("persists rotated refresh tokens and serializes concurrent refreshes", async () => {
    await connections!.saveConnection(playerId, { ...authorization, expiresAt: new Date(Date.now() + 1_000) }, "activity:read_all");
    const refresh = vi.fn(async (token: string) => {
      expect(token).toBe("refresh-1");
      return { accessToken: "access-2", refreshToken: "refresh-2", expiresAt: new Date(Date.now() + 3_600_000) };
    });
    expect(await Promise.all([connections!.getAccessToken(playerId, refresh), connections!.getAccessToken(playerId, refresh)]))
      .toEqual(["access-2", "access-2"]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("marks the connection for reconnect when refresh is revoked", async () => {
    await connections!.saveConnection(playerId, { ...authorization, expiresAt: new Date(Date.now() - 1_000) }, "activity:read_all");
    await expect(connections!.getAccessToken(playerId, async () => { throw new StravaError("reconnect_required"); }))
      .rejects.toMatchObject({ code: "reconnect_required" });
    expect((await connections!.getStatus(playerId)).status).toBe("reconnect_required");
    await expect(connections!.getAccessToken(playerId, vi.fn())).rejects.toMatchObject({ code: "reconnect_required" });
  });

  it("deletes local credentials and pending states on disconnect", async () => {
    await connections!.saveConnection(playerId, authorization, "activity:read_all");
    await connections!.createOAuthState(playerId, sessionId, "en");
    expect(await connections!.deleteConnection(playerId)).toEqual({ accessToken: "access-1" });
    expect((await pool!.query("SELECT 1 FROM strava_connections UNION ALL SELECT 1 FROM strava_oauth_states")).rowCount).toBe(0);
    expect(await connections!.getStatus(playerId)).toEqual({ status: "disconnected" });
  });
});
