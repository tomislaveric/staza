import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Activity, ActivityResult } from "../domain.js";
import { createDatabasePool } from "./database.js";
import { ActivityRepository } from "./activityRepository.js";
import { migrate } from "./migrate.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describePersistence = databaseUrl ? describe : describe.skip;
const playerId = "00000000-0000-4000-8000-000000000099";
const pool = databaseUrl ? createDatabasePool(databaseUrl) : undefined;
const repository = pool ? new ActivityRepository(pool) : undefined;

const activity = (id: string): Activity => ({
  id,
  source: "fit",
  type: "unknown",
  startedAt: Date.parse("2026-01-02T03:04:05.000Z"),
  endedAt: Date.parse("2026-01-02T03:14:05.000Z"),
  route: [
    { latitude: 55.6761, longitude: 12.5683, timestampMs: Date.parse("2026-01-02T03:04:05.000Z") },
    { latitude: 55.6771, longitude: 12.5693, timestampMs: Date.parse("2026-01-02T03:14:05.000Z") }
  ],
  distance: 12_345,
  duration: 600
});

const result = (activityId: string, value = 25): ActivityResult => ({
  activityId,
  distance: 12_345,
  duration: 600,
  collectedCount: 1,
  totalPoints: value,
  collectibles: [{
    id: "historic-coin", name: "Historic Coin", type: "coin", rarity: "rare",
    latitude: 55.6761, longitude: 12.5683, radiusMeters: 15, value
  }],
  events: [{
    id: "historic-coin",
    sourceId: "historic-coin",
    type: "collectible_collected",
    collectible: { name: "Historic Coin", type: "coin", rarity: "rare" },
    value,
    latitude: 55.6761,
    longitude: 12.5683,
    activityTimestamp: 1_790_090_187_586.4768
  }],
  nearMisses: [{
    collectibleId: "historic-near-miss",
    name: "Historic Near Miss",
    value: 10,
    rarity: "epic",
    minimumDistanceMeters: 73.25
  }]
});

describePersistence("ActivityRepository", () => {
  beforeEach(async () => {
    await migrate(pool!);
    await pool!.query("TRUNCATE activity_events, activities, players CASCADE");
    await pool!.query("INSERT INTO players (id, display_name) VALUES ($1, $2)", [playerId, "Persistence test player"]);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("persists snapshots, orders history, and only awards an activity once", async () => {
    const firstId = "a".repeat(48);
    const first = await repository!.persistCompletedActivity(playerId, activity(firstId), result(firstId));
    const repeated = await repository!.persistCompletedActivity(playerId, activity(firstId), result(firstId));
    const secondId = "b".repeat(48);
    await repository!.persistCompletedActivity(playerId, activity(secondId), result(secondId, 0));

    expect(first.inserted).toBe(true);
    expect(repeated.inserted).toBe(false);
    expect(repeated.progress.totalXp).toBe(25);
    expect(await repository!.getProgress(playerId)).toMatchObject({ totalXp: 25, level: 1 });
    expect(await repository!.listActivities(playerId)).toEqual([
      expect.objectContaining({ id: secondId, xpEarned: 0, hasVideo: false }),
      expect.objectContaining({ id: firstId, distanceMeters: 12_345, durationSeconds: 600, collectedCount: 1 })
    ]);
    expect(await repository!.getActivity(playerId, firstId)).toMatchObject({
      id: firstId,
      xpEarned: 25,
      events: [expect.objectContaining({
        sourceId: "historic-coin",
        collectible: { name: "Historic Coin", type: "coin", rarity: "rare" },
        value: 25,
        activityTimestamp: 1_790_090_187_586.4768
      })],
      replay: {
        version: 1,
        activity: activity(firstId),
        activityResult: result(firstId)
      }
    });

  });

  it("uses an import key to make separate submissions resolve to one activity and XP award", async () => {
    const importKey = "73fa9c8d-2c12-4c11-9bd6-4000f8104001";
    const originalId = "i".repeat(48);
    const retryId = "j".repeat(48);
    const first = await repository!.persistCompletedActivity(playerId, activity(originalId), result(originalId, 40), importKey);
    const retried = await repository!.persistCompletedActivity(playerId, activity(retryId), result(retryId, 40), importKey);

    expect(first.inserted).toBe(true);
    expect(retried.inserted).toBe(false);
    expect(retried.activity.id).toBe(originalId);
    expect(await repository!.listActivities(playerId)).toHaveLength(1);
    expect(await repository!.getProgress(playerId)).toMatchObject({ totalXp: 40 });
    expect((await repository!.getActivity(playerId, originalId))?.events).toHaveLength(1);
  });

  it("reconstructs durable state from a new repository and marks video separately", async () => {
    const id = "c".repeat(48);
    await repository!.persistCompletedActivity(playerId, activity(id), result(id, 100));
    await repository!.markActivityHasVideo(playerId, id);
    const restartedRepository = new ActivityRepository(pool!);

    expect(await restartedRepository.getProgress(playerId)).toMatchObject({
      totalXp: 100, level: 2, currentLevelXp: 0, nextLevelXp: 200, progressToNextLevel: 0
    });

    expect(await restartedRepository.getActivity(playerId, id)).toMatchObject({ hasVideo: true });
  });

  it("stores one durable source video per activity without changing activity truth", async () => {
    const id = "v".repeat(48);
    await repository!.persistCompletedActivity(playerId, activity(id), result(id, 100));
    const initialProgress = await repository!.getProgress(playerId);
    const created = await repository!.createActivityVideo(playerId, id, "00000000-0000-4000-8000-000000000123", "source.mp4", "/durable/source.mp4");
    await repository!.updateActivityVideo(playerId, id, {
      ...created,
      state: "sync_failed",
      error: "No GPS5 track was found."
    });

    await expect(repository!.createActivityVideo(playerId, id,
      "00000000-0000-4000-8000-000000000124",
      "replacement.mp4",
      "/durable/replacement.mp4"
    )).rejects.toThrow("already attached");
    const restartedRepository = new ActivityRepository(pool!);
    expect(await restartedRepository.getActivity(playerId, id)).toMatchObject({
      id,
      xpEarned: 100,
      events: [expect.objectContaining({ sourceId: "historic-coin" })],
      video: { state: "sync_failed", sourceFilename: "source.mp4", error: "No GPS5 track was found." }
    });
    expect(await restartedRepository.getProgress(playerId)).toEqual(initialProgress);
  });

  it("retains interrupted video work as an explicit durable failure after restart", async () => {
    const id = "r".repeat(48);
    await repository!.persistCompletedActivity(playerId, activity(id), result(id));
    await repository!.createActivityVideo(playerId, id, "00000000-0000-4000-8000-000000000125", "source.mp4", "/durable/source.mp4");
    await repository!.markInterruptedActivityVideos();

    expect((await repository!.getActivity(playerId, id))?.video).toMatchObject({
      state: "sync_failed",
      error: "Video processing was interrupted by a server restart."
    });
  });

  it("clears only retryable video media without changing the activity result", async () => {
    const id = "t".repeat(48);
    await repository!.persistCompletedActivity(playerId, activity(id), result(id, 55));
    const before = await repository!.getProgress(playerId);
    const created = await repository!.createActivityVideo(playerId, id,
      "00000000-0000-4000-8000-000000000126",
      "unmatched.mp4",
      "/durable/unmatched.mp4"
    );
    await repository!.updateActivityVideo(playerId, id, { ...created, state: "no_highlights", events: [] });

    await expect(repository!.removeRetryableActivityVideo(playerId, id)).resolves.toBe("/durable/unmatched.mp4");
    expect(await repository!.getActivity(playerId, id)).toMatchObject({
      id,
      xpEarned: 55,
      events: [expect.objectContaining({ sourceId: "historic-coin" })]
    });
    expect((await repository!.getActivity(playerId, id))?.video).toBeUndefined();
    expect(await repository!.getProgress(playerId)).toEqual(before);
  });

  it("returns each discovered source ID once for the current player only", async () => {
    await repository!.persistCompletedActivity(playerId, activity("e".repeat(48)), result("e".repeat(48)));
    await repository!.persistCompletedActivity(playerId, activity("f".repeat(48)), result("f".repeat(48)));
    const otherPlayerId = "00000000-0000-4000-8000-000000000098";
    const otherRepository = new ActivityRepository(pool!);
    await pool!.query("INSERT INTO players (id, display_name) VALUES ($1, $2)", [otherPlayerId, "Other player"]);
    await otherRepository.persistCompletedActivity(otherPlayerId, activity("g".repeat(48)), result("g".repeat(48)));

    expect(await repository!.listDiscoveredCollectibleSourceIds(playerId)).toEqual(["historic-coin"]);
  });

  it("builds a read-only Progress dashboard from canonical persisted aggregates", async () => {
    const rare = result("a".repeat(48), 25);
    rare.events[0] = {
      ...rare.events[0],
      sourceId: "shared-rare",
      collectible: { name: "Shared Rare", type: "coin", rarity: "rare" }
    };
    const duplicateRare = result("b".repeat(48), 25);
    duplicateRare.events[0] = {
      ...duplicateRare.events[0],
      sourceId: "shared-rare",
      collectible: { name: "Shared Rare", type: "coin", rarity: "rare" }
    };
    const epic = result("c".repeat(48), 25);
    epic.events[0] = {
      ...epic.events[0],
      sourceId: "epic-landmark",
      collectible: { name: "Epic Landmark", type: "landmark", rarity: "epic" }
    };
    const common = result("d".repeat(48), 25);
    common.events[0] = {
      ...common.events[0],
      sourceId: "common-coin",
      collectible: { name: "Common Coin", type: "coin", rarity: "common" }
    };
    const empty = result("e".repeat(48), 25);
    empty.events = [];
    empty.collectibles = [];
    empty.collectedCount = 0;
    const noDistance = { ...activity("e".repeat(48)), distance: undefined };

    await repository!.persistCompletedActivity(playerId, activity("a".repeat(48)), rare);
    await repository!.persistCompletedActivity(playerId, activity("b".repeat(48)), duplicateRare);
    await repository!.persistCompletedActivity(playerId, activity("c".repeat(48)), epic);
    await repository!.persistCompletedActivity(playerId, activity("d".repeat(48)), common);
    await repository!.persistCompletedActivity(playerId, noDistance, empty);
    const before = await repository!.getProgress(playerId);

    const dashboard = await repository!.getProgressDashboard(playerId);

    expect(dashboard.progress).toEqual(before);
    expect(dashboard.lifetime).toEqual({
      distanceMeters: 49_380,
      totalCollectibles: 3,
      rareOrBetterCollectibles: 2
    });
    expect(dashboard.levels).toEqual([
      { level: 1, totalXpRequired: 0 },
      { level: 2, totalXpRequired: 100 },
      { level: 3, totalXpRequired: 300 },
      { level: 4, totalXpRequired: 600 },
      { level: 5, totalXpRequired: 1_000 }
    ]);
    expect(dashboard.recentActivities.map((item) => item.id)).toEqual([
      "e".repeat(48), "d".repeat(48), "c".repeat(48), "b".repeat(48)
    ]);
    expect(await repository!.getProgress(playerId)).toEqual(before);
  });

  it("rolls back the activity and XP when an event insert fails", async () => {
    const id = "d".repeat(48);
    const invalid = result(id, 30);
    invalid.events.push({ ...invalid.events[0], id: "duplicate", value: 5 });

    await expect(repository!.persistCompletedActivity(playerId, activity(id), invalid)).rejects.toThrow();
    expect(await repository!.listActivities(playerId)).toEqual([]);
    expect(await repository!.getProgress(playerId)).toMatchObject({ totalXp: 0 });
  });
});
