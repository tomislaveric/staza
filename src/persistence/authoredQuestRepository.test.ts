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

  const startedBefore = new Date("2026-05-01T00:00:00Z");
  const outcomeOf = async (id: string) => (await activities!.getActivity(playerId, id))!.replay!.outcome!;

  it("completes an explicitly started step on the next activity, once, with difficulty XP", async () => {
    // endurance-i: 30 km ride (easy), then 50 km ride
    await activities!.persistCompletedActivity(playerId, ride("a".repeat(48), 60_000), result("a".repeat(48)));
    expect(await totalXp()).toBe(10);

    await pool!.query("INSERT INTO skill_tree_unlocks (player_id, node_id, cost) VALUES ($1, 'endurance-i', 1)", [playerId]);
    // Nothing completes without starting, and earlier activities never count.
    await activities!.persistCompletedActivity(playerId, ride("e".repeat(48), 60_000), result("e".repeat(48)));
    expect((await quests!.list(playerId)).filter((quest) => quest.state === "completed")).toEqual([]);

    await quests!.start(playerId, "distance-quests:1", startedBefore);
    await expect(quests!.start(playerId, "distance-quests:1")).rejects.toThrow("already active");
    await expect(quests!.start(playerId, "distance-quests:2")).rejects.toThrow("previous quest");
    await activities!.persistCompletedActivity(playerId, ride("b".repeat(48), 35_000), result("b".repeat(48)));
    const completed = (await quests!.list(playerId)).filter((quest) => quest.state === "completed");
    expect(completed.map((quest) => quest.id)).toEqual(["distance-quests:1"]);
    expect(completed[0].xp).toBe(100);
    expect(await totalXp()).toBe(30 + completed[0].xp);
    expect((await outcomeOf("b".repeat(48))).quests).toMatchObject([
      { questId: "distance-quests:1", result: "completed", xp: 100, next: { id: "distance-quests:2" } }
    ]);

    // Same activity returned again awards nothing more.
    await activities!.persistCompletedActivity(playerId, ride("b".repeat(48), 35_000), result("b".repeat(48)));
    expect(await totalXp()).toBe(30 + completed[0].xp);
  });

  it("fails the attempt on the next activity that falls short and allows a retry", async () => {
    await pool!.query("INSERT INTO skill_tree_unlocks (player_id, node_id, cost) VALUES ($1, 'endurance-i', 1)", [playerId]);
    await quests!.start(playerId, "distance-quests:1", startedBefore);
    await activities!.persistCompletedActivity(playerId, ride("f".repeat(48), 10_000), result("f".repeat(48)));
    const failed = (await quests!.list(playerId)).find((quest) => quest.id === "distance-quests:1")!;
    expect(failed).toMatchObject({ state: "failed", attempt: { attemptCount: 1 } });
    expect(failed.attempt!.criteria!.filter((criterion) => !criterion.met).map((criterion) => criterion.label)).toEqual(["Distance"]);
    expect(await totalXp()).toBe(10);
    expect((await outcomeOf("f".repeat(48))).quests[0]).toMatchObject({ result: "failed", xp: 0 });

    // A failed attempt does not resolve again until it is retried.
    await activities!.persistCompletedActivity(playerId, ride("g".repeat(48), 60_000), result("g".repeat(48)));
    expect((await quests!.list(playerId)).find((quest) => quest.id === "distance-quests:1")!.state).toBe("failed");

    await quests!.start(playerId, "distance-quests:1", startedBefore);
    await activities!.persistCompletedActivity(playerId, ride("h".repeat(48), 60_000), result("h".repeat(48)));
    const done = (await quests!.list(playerId)).find((quest) => quest.id === "distance-quests:1")!;
    expect(done.state).toBe("completed");
    expect(await totalXp()).toBe(30 + 100);
  });

  it("does not complete a quest for the wrong sport", async () => {
    await pool!.query("INSERT INTO skill_tree_unlocks (player_id, node_id, cost) VALUES ($1, 'endurance-i', 1)", [playerId]);
    await quests!.start(playerId, "distance-quests:1", startedBefore);
    await activities!.persistCompletedActivity(playerId, ride("c".repeat(48), 60_000, "running"), result("c".repeat(48)));
    expect((await quests!.list(playerId)).some((quest) => quest.state === "completed")).toBe(false);
  });

  it("ignores an attempt started after the activity began", async () => {
    await pool!.query("INSERT INTO skill_tree_unlocks (player_id, node_id, cost) VALUES ($1, 'endurance-i', 1)", [playerId]);
    await quests!.start(playerId, "distance-quests:1", new Date("2026-07-01T00:00:00Z"));
    await activities!.persistCompletedActivity(playerId, ride("i".repeat(48), 5_000), result("i".repeat(48)));
    expect((await quests!.list(playerId)).find((quest) => quest.id === "distance-quests:1")!.state).toBe("active");
  });
});
