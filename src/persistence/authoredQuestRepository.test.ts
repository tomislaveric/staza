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
    await pool!.query("TRUNCATE skill_tree_unlocks, authored_quest_completions, activity_events, activities, players CASCADE");
    await pool!.query("INSERT INTO players (id, display_name, created_at) VALUES ($1, 'Quest player', '2020-01-01')", [playerId]);
  });
  afterAll(async () => { await pool?.end(); });

  it("completes a step only while its node is unlocked, once, with XP", async () => {
    // endurance-i: 30 km ride, then 50 km ride
    await activities!.persistCompletedActivity(playerId, ride("a".repeat(48), 60_000), result("a".repeat(48)));
    expect(await totalXp()).toBe(10);

    await pool!.query("INSERT INTO skill_tree_unlocks (player_id, node_id, cost) VALUES ($1, 'endurance-i', 1)", [playerId]);
    // Not retroactive: the earlier 60 km ride counts for nothing.
    expect((await quests!.list(playerId)).filter((quest) => quest.state === "completed")).toEqual([]);

    await activities!.persistCompletedActivity(playerId, ride("b".repeat(48), 35_000), result("b".repeat(48)));
    const completed = (await quests!.list(playerId)).filter((quest) => quest.state === "completed");
    expect(completed.map((quest) => quest.chainId)).toEqual(["distance-quests"]);
    expect(await totalXp()).toBe(10 + 10 + completed[0].xp);

    // Same activity returned again awards nothing more.
    await activities!.persistCompletedActivity(playerId, ride("b".repeat(48), 35_000), result("b".repeat(48)));
    expect(await totalXp()).toBe(20 + completed[0].xp);
  });

  it("does not complete a quest for the wrong sport", async () => {
    await pool!.query("INSERT INTO skill_tree_unlocks (player_id, node_id, cost) VALUES ($1, 'endurance-i', 1)", [playerId]);
    await activities!.persistCompletedActivity(playerId, ride("c".repeat(48), 60_000, "running"), result("c".repeat(48)));
    expect((await quests!.list(playerId)).some((quest) => quest.state === "completed")).toBe(false);
  });

  it("updates the sport of a stored activity and its fallback title", async () => {
    const id = "d".repeat(48);
    await activities!.persistCompletedActivity(playerId, ride(id, 5000, "unknown"), result(id));
    const updated = await activities!.updateActivityType(playerId, id, "running");
    expect(updated?.type).toBe("running");
    expect(await activities!.updateActivityType(playerId, "missing", "running")).toBeUndefined();
  });
});
