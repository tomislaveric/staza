import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Activity, ActivityResult } from "../domain.js";
import { ActivityRepository } from "./activityRepository.js";
import { AuthoredQuestRepository } from "./authoredQuestRepository.js";
import { createDatabasePool } from "./database.js";
import { migrate } from "./migrate.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describePersistence = databaseUrl ? describe : describe.skip;
const playerId = "00000000-0000-4000-8000-0000000000a1";
const pool = databaseUrl ? createDatabasePool(databaseUrl) : undefined;
const activities = pool ? new ActivityRepository(pool) : undefined;
const quests = pool ? new AuthoredQuestRepository(pool) : undefined;

const ride = (id: string, distance: number, type: Activity["type"] = "cycling"): Activity => ({
  id, source: "fit", type,
  startedAt: Date.parse("2026-06-01T08:00:00Z"), endedAt: Date.parse("2026-06-01T09:00:00Z"),
  route: [], distance, duration: 3600
});
const result = (id: string): ActivityResult => ({
  activityId: id, collectedCount: 0, totalPoints: 10, distanceXp: 0, distanceXpRewards: [],
  collectibles: [], events: [], nearMisses: [], fartlekCompletions: []
});
const totalXp = async () => (await pool!.query("SELECT total_xp FROM players WHERE id = $1", [playerId])).rows[0].total_xp;

describePersistence("authored quests", () => {
  beforeEach(async () => {
    await migrate(pool!);
    await pool!.query("TRUNCATE skill_tree_unlocks, authored_quest_completions, authored_quest_attempts, activity_events, activities, players CASCADE");
    await pool!.query("INSERT INTO players (id, display_name, created_at) VALUES ($1, 'Quest player', '2020-01-01')", [playerId]);
  });
  afterAll(async () => { await pool?.end(); });

  const unlock = (nodeId: string, at: string) =>
    pool!.query("INSERT INTO skill_tree_unlocks (player_id, node_id, cost, unlocked_at) VALUES ($1, $2, 1, $3)", [playerId, nodeId, at]);
  const outcomeOf = async (id: string) => (await activities!.getActivity(playerId, id))!.replay!.outcome!;
  const quest = async (id: string) => (await quests!.list(playerId)).find((entry) => entry.id === id)!;

  it("completes an unlocked step on the next activity, once, with difficulty XP", async () => {
    // endurance-i: 30 km ride (easy), then 50 km ride
    await activities!.persistCompletedActivity(playerId, ride("a".repeat(48), 60_000), result("a".repeat(48)));
    expect(await totalXp()).toBe(10);

    // Activities that started before the node was unlocked never count.
    await unlock("endurance-i", "2026-06-02T00:00:00Z");
    expect((await quest("distance-quests:1")).state).toBe("active");
    await activities!.persistCompletedActivity(playerId, ride("e".repeat(48), 60_000), result("e".repeat(48)));
    expect((await quests!.list(playerId)).filter((entry) => entry.state === "completed")).toEqual([]);

    await pool!.query("UPDATE skill_tree_unlocks SET unlocked_at = '2026-05-01T00:00:00Z'");
    await activities!.persistCompletedActivity(playerId, ride("b".repeat(48), 35_000), result("b".repeat(48)));
    const completed = (await quests!.list(playerId)).filter((entry) => entry.state === "completed");
    expect(completed.map((entry) => entry.id)).toEqual(["distance-quests:1"]);
    expect(completed[0].xp).toBe(100);
    expect(await totalXp()).toBe(30 + completed[0].xp);
    expect((await outcomeOf("b".repeat(48))).quests).toMatchObject([
      { questId: "distance-quests:1", result: "completed", xp: 100, next: { id: "distance-quests:2" } }
    ]);
    // The same activity never also completes the next step.
    expect((await quest("distance-quests:2")).state).toBe("active");

    await activities!.persistCompletedActivity(playerId, ride("b".repeat(48), 35_000), result("b".repeat(48)));
    expect(await totalXp()).toBe(30 + completed[0].xp);
  });

  it("records a failure, keeps the quest active and completes it on a later activity", async () => {
    await unlock("endurance-i", "2026-05-01T00:00:00Z");
    await activities!.persistCompletedActivity(playerId, ride("f".repeat(48), 10_000), result("f".repeat(48)));
    const failed = await quest("distance-quests:1");
    expect(failed).toMatchObject({ state: "active", lastFailure: { attemptCount: 1 } });
    expect(failed.lastFailure!.criteria!.filter((criterion) => !criterion.met).map((criterion) => criterion.label)).toEqual(["Distance"]);
    expect(await totalXp()).toBe(10);
    expect((await outcomeOf("f".repeat(48))).quests[0]).toMatchObject({ result: "failed", xp: 0 });

    await activities!.persistCompletedActivity(playerId, ride("h".repeat(48), 60_000), result("h".repeat(48)));
    expect((await quest("distance-quests:1")).state).toBe("completed");
    expect(await totalXp()).toBe(20 + 100);
  });

  it("ignores an activity of the wrong sport and still counts the next matching one", async () => {
    await unlock("endurance-i", "2026-05-01T00:00:00Z");
    await activities!.persistCompletedActivity(playerId, ride("c".repeat(48), 60_000, "running"), result("c".repeat(48)));
    expect((await quest("distance-quests:1")).state).toBe("active");
    expect((await outcomeOf("c".repeat(48))).quests).toEqual([]);

    await activities!.persistCompletedActivity(playerId, ride("d".repeat(48), 60_000), result("d".repeat(48)));
    expect((await quest("distance-quests:1")).state).toBe("completed");
  });

  it("lets historic activities resolve quests when dev tools are on", async () => {
    await unlock("endurance-i", "2026-07-01T00:00:00Z");
    const dev = new ActivityRepository(pool!, true);
    await dev.persistCompletedActivity(playerId, ride("j".repeat(48), 60_000), result("j".repeat(48)));
    expect((await quest("distance-quests:1")).state).toBe("completed");
  });

  it("flags quests as new until the player's rewards are marked seen", async () => {
    await unlock("endurance-i", new Date().toISOString());
    expect((await quest("distance-quests:1")).isNew).toBe(true);
    await pool!.query("UPDATE players SET rewards_seen_at = now() + interval '1 minute' WHERE id = $1", [playerId]);
    expect((await quest("distance-quests:1")).isNew).toBe(false);
  });
});
