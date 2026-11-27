import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Activity, ActivityResult, NewPlannedRoute, QuestObjective } from "../domain.js";
import { ActivityRepository } from "./activityRepository.js";
import type { NewExploration } from "../exploration/service.js";
import { createDatabasePool } from "./database.js";
import { migrate } from "./migrate.js";
import { EXPLORATION_TEMPLATE, QuestInstanceRepository } from "./questInstanceRepository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describePersistence = databaseUrl ? describe : describe.skip;
const playerId = "00000000-0000-4000-8000-0000000000e1";
const pool = databaseUrl ? createDatabasePool(databaseUrl) : undefined;
const repository = pool ? new QuestInstanceRepository(pool) : undefined;

const peakObjectives: QuestObjective[] = [{
  id: "collectibles-peak",
  type: "collectible_targets",
  requiredCount: 3,
  category: "peak",
  targets: [
    { id: "peak-a", name: "Peak A" },
    { id: "peak-b", name: "Peak B" },
    { id: "peak-c", name: "Peak C" }
  ]
}];

const exploration = (proposalId: string = randomUUID()): NewExploration => ({
  proposalId,
  title: "Exploration: Peak A, Peak B +1",
  description: "Visit 3 Peaks.",
  objectives: peakObjectives
});

const route = (proposalId: string, overrides: Partial<NewPlannedRoute> = {}): NewPlannedRoute => ({
  proposalId,
  profile: "bicycle",
  routeType: "round_trip",
  start: { lat: 49.1, lon: 8.1 },
  end: { lat: 49.1, lon: 8.1 },
  distanceM: 48_000,
  durationS: 7_200,
  elevationGainM: 420,
  geometry: { type: "LineString", coordinates: [[8.1, 49.1], [8.2, 49.2], [8.1, 49.1]] },
  includedTargetIds: ["peak-a", "peak-b", "peak-c"],
  plannerVersion: 2,
  ...overrides
});

const activities = pool ? new ActivityRepository(pool) : undefined;
const startedBefore = new Date("2026-05-01T00:00:00Z");

const rideWith = async (id: string, sourceIds: string[], activityStartedAt = "2026-06-01T08:00:00Z") => {
  const activity: Activity = {
    id, source: "fit", type: "cycling", startedAt: Date.parse(activityStartedAt),
    endedAt: Date.parse(activityStartedAt) + 3_600_000, route: [], distance: 20_000, duration: 3600
  };
  const result: ActivityResult = {
    activityId: id, collectedCount: sourceIds.length, totalPoints: sourceIds.length * 10, distanceXp: 0,
    distanceXpRewards: [], collectibles: [], nearMisses: [], fartlekCompletions: [],
    events: sourceIds.map((sourceId, index) => ({
      id: sourceId, sourceId, type: "collectible_collected" as const,
      collectible: { name: sourceId, type: "landmark" as const },
      value: 10, latitude: 49, longitude: 8, activityTimestamp: index + 1
    }))
  };
  return activities!.persistCompletedActivity(playerId, activity, result);
};
const totalXp = async () => (await pool!.query("SELECT total_xp FROM players WHERE id = $1", [playerId])).rows[0].total_xp;
const confirmExploration = async (): Promise<string> => {
  const proposalId = randomUUID();
  return repository!.createExploration(playerId, exploration(proposalId), route(proposalId), startedBefore);
};

describePersistence("QuestInstanceRepository", () => {
  beforeEach(async () => {
    await migrate(pool!);
    await pool!.query("TRUNCATE quest_instances, activity_events, activities, players CASCADE");
    await pool!.query("INSERT INTO players (id, display_name, created_at) VALUES ($1, 'Quest test player', '2020-01-01')", [playerId]);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("saves an exploration as active with its route atomically", async () => {
    const proposalId = randomUUID();
    const instanceId = await repository!.createExploration(playerId, exploration(proposalId), route(proposalId), startedBefore);

    const [instance] = await repository!.listForPlayer(playerId);
    expect(instance).toMatchObject({
      id: instanceId,
      templateId: EXPLORATION_TEMPLATE.id,
      suggestionId: proposalId,
      title: "Exploration: Peak A, Peak B +1",
      status: "active",
      startedAt: startedBefore.toISOString(),
      difficulty: "medium",
      rewardXp: 250,
      attemptCount: 1,
      objectives: [{ progress: { completed: 0, required: 3 } }]
    });
    expect(await repository!.getPlannedRoute(playerId, instanceId)).toMatchObject({
      questInstanceId: instanceId,
      proposalId,
      distanceM: 48_000,
      elevationGainM: 420,
      includedTargetIds: ["peak-a", "peak-b", "peak-c"]
    });
    expect(await repository!.getPlannedRoute("00000000-0000-4000-8000-0000000000e2", instanceId)).toBeUndefined();
  });

  it("ignores activities started before saving and lists saved routes overlapping a viewport", async () => {
    const proposalId = randomUUID();
    const instanceId = await repository!.createExploration(
      playerId, exploration(proposalId), route(proposalId), new Date("2026-06-02T00:00:00Z")
    );
    await rideWith("earlier-ride", ["peak-a"]);
    expect((await repository!.listForPlayer(playerId))[0]).toMatchObject({
      status: "active", objectives: [{ progress: { completed: 0 } }]
    });

    const inside = { minLongitude: 8.15, minLatitude: 49.15, maxLongitude: 8.3, maxLatitude: 49.3 };
    const outside = { minLongitude: 9, minLatitude: 50, maxLongitude: 9.1, maxLatitude: 50.1 };
    expect(await repository!.listRoutesWithinBounds(playerId, inside)).toMatchObject([{ id: instanceId, status: "active" }]);
    expect(await repository!.listRoutesWithinBounds(playerId, outside)).toEqual([]);
  });

  it("completes in one activity, granting the reward exactly once", async () => {
    const instanceId = await confirmExploration();
    const { activity } = await rideWith("quest-pass", ["peak-a", "peak-b", "peak-c"]);
    expect(activity.replay!.outcome!.quests).toMatchObject([{ questId: instanceId, result: "completed", xp: 250 }]);
    expect(await totalXp()).toBe(30 + 250);
    const [instance] = await repository!.listForPlayer(playerId);
    expect(instance).toMatchObject({ status: "completed", resolvedActivityId: "quest-pass" });

    await rideWith("quest-pass", ["peak-a", "peak-b", "peak-c"]);
    expect(await totalXp()).toBe(30 + 250);
  });

  it("accumulates progress across activities after the start", async () => {
    const instanceId = await confirmExploration();
    await rideWith("before-start", ["peak-c"], "2026-04-01T08:00:00Z");
    expect((await repository!.listForPlayer(playerId))[0].status).toBe("active");

    const first = await rideWith("quest-part-1", ["peak-a", "peak-b"]);
    expect(first.activity.replay!.outcome!.quests).toMatchObject([{ questId: instanceId, result: "progressed", xp: 0 }]);
    let [instance] = await repository!.listForPlayer(playerId);
    expect(instance).toMatchObject({
      status: "partially_completed", resolvedActivityId: "quest-part-1",
      objectives: [{ progress: { completed: 2, required: 3, complete: false } }]
    });

    // Reaching nothing new leaves the exploration untouched.
    const repeat = await rideWith("quest-repeat", ["peak-a"], "2026-06-01T12:00:00Z");
    expect(repeat.activity.replay!.outcome!.quests).toEqual([]);

    const second = await rideWith("quest-part-2", ["peak-c"], "2026-06-02T08:00:00Z");
    expect(second.activity.replay!.outcome!.quests).toMatchObject([{ questId: instanceId, result: "completed", xp: 250 }]);
    [instance] = await repository!.listForPlayer(playerId);
    expect(instance).toMatchObject({ status: "completed", resolvedActivityId: "quest-part-2" });
    // peak-c was first collected before the start: only peaks a, b and the reward are new XP.
    expect(await totalXp()).toBe(30 + 250);

    await rideWith("quest-after", ["peak-a", "peak-b", "peak-c"], "2026-06-03T08:00:00Z");
    expect(await totalXp()).toBe(30 + 250);
  });

  it("returns the same exploration when a proposal is confirmed twice", async () => {
    const proposalId = randomUUID();
    const first = await repository!.createExploration(playerId, exploration(proposalId), route(proposalId));
    const second = await repository!.createExploration(playerId, exploration(proposalId), route(proposalId, { distanceM: 1 }));
    expect(second).toBe(first);
    expect(await repository!.listForPlayer(playerId)).toHaveLength(1);
    expect((await repository!.getPlannedRoute(playerId, first))?.distanceM).toBe(48_000);
  });

  it("rolls back the exploration when its route cannot be stored", async () => {
    const proposalId = randomUUID();
    await expect(repository!.createExploration(playerId, exploration(proposalId),
      route(proposalId, { routeType: "loop" as unknown as "round_trip" }))).rejects.toThrow();
    expect(await repository!.listForPlayer(playerId)).toEqual([]);
  });

  it("deletes an exploration of any status with its planned route", async () => {
    const proposalId = randomUUID();
    const instanceId = await repository!.createExploration(playerId, exploration(proposalId), route(proposalId));
    await repository!.cancel(playerId, instanceId);
    expect(await repository!.listForPlayer(playerId)).toEqual([]);
    const remaining = await pool!.query("SELECT 1 FROM planned_routes WHERE quest_instance_id = $1", [instanceId]);
    expect(remaining.rowCount).toBe(0);

    const completedId = await confirmExploration();
    await rideWith("done", ["peak-a", "peak-b", "peak-c"]);
    await repository!.cancel(playerId, completedId);
    expect(await repository!.listForPlayer(playerId)).toEqual([]);
  });
});
