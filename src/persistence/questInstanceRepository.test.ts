import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { NewPlannedRoute, QuestObjective } from "../domain.js";
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

/** A quest started through the retired suggestion flow: all-time progress, curated template. */
const insertLegacyInstance = async (): Promise<string> => {
  await pool!.query(
    `INSERT INTO quest_templates (id, version, title, description, recommended_level, objectives, active)
     VALUES ('history-peak-test', 1, 'Peak collection', 'Discover three peaks.', 2, '[]', false)
     ON CONFLICT (id, version) DO NOTHING`
  );
  const id = randomUUID();
  await pool!.query(
    `INSERT INTO quest_instances (
      id, player_id, template_id, template_version, scope_hash, title, description, recommended_level, objectives
    ) VALUES ($1, $2, 'history-peak-test', 1, $3, 'Peak collection', 'Discover three peaks.', 2, $4)`,
    [id, playerId, "a".repeat(32), JSON.stringify(peakObjectives)]
  );
  return id;
};

const insertActivity = async (id: string): Promise<void> => {
  await pool!.query(
    `INSERT INTO activities (
      id, player_id, source_type, activity_type, started_at, xp_earned, collected_count
    ) VALUES ($1, $2, 'fit', 'cycling', now(), 0, 0)`,
    [id, playerId]
  );
};

const insertDiscovery = async (activityId: string, sourceId: string, timestampMs = 1): Promise<void> => {
  await pool!.query(
    `INSERT INTO activity_events (
      id, activity_id, source_id, event_type, activity_timestamp, value, latitude, longitude,
      collectible_name, collectible_type, collectible_category
    ) VALUES ($1, $2, $3, 'collectible_collected', $4, 10, 49, 8, $3, 'landmark', 'peak')`,
    [randomUUID(), activityId, sourceId, timestampMs]
  );
};

describePersistence("QuestInstanceRepository", () => {
  beforeEach(async () => {
    await migrate(pool!);
    await pool!.query("TRUNCATE quest_instances, activity_events, activities, players CASCADE");
    await pool!.query("INSERT INTO players (id, display_name) VALUES ($1, 'Quest test player')", [playerId]);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("keeps historical quests readable with all-time progress", async () => {
    await insertActivity("history-activity-1");
    await insertDiscovery("history-activity-1", "peak-a");
    await insertDiscovery("history-activity-1", "peak-b");
    const instanceId = await insertLegacyInstance();
    let instances = await repository!.listForPlayer(playerId);
    expect(instances).toMatchObject([{
      id: instanceId,
      suggestionId: "a".repeat(32),
      status: "active",
      objectives: [{ progress: { completed: 2, required: 3, complete: false } }]
    }]);

    await insertActivity("history-activity-2");
    await insertDiscovery("history-activity-2", "peak-c");
    instances = await repository!.listForPlayer(playerId);
    expect(instances[0].status).toBe("completed");
    expect(instances[0].completedAt).toBeDefined();
  });

  it("creates an exploration with its route atomically and counts only progress after confirmation", async () => {
    await insertActivity("before-confirmation");
    await insertDiscovery("before-confirmation", "peak-a");
    const proposalId = randomUUID();
    const instanceId = await repository!.createExploration(playerId, exploration(proposalId), route(proposalId));

    const [instance] = await repository!.listForPlayer(playerId);
    expect(instance).toMatchObject({
      id: instanceId,
      templateId: EXPLORATION_TEMPLATE.id,
      suggestionId: proposalId,
      title: "Exploration: Peak A, Peak B +1",
      status: "active",
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

    await insertActivity("after-confirmation");
    await insertDiscovery("after-confirmation", "peak-b", Date.now() + 1_000);
    expect((await repository!.listForPlayer(playerId))[0].objectives[0].progress.completed).toBe(1);
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

  it("deletes the planned route with its cancelled exploration", async () => {
    const proposalId = randomUUID();
    const instanceId = await repository!.createExploration(playerId, exploration(proposalId), route(proposalId));
    await repository!.cancel(playerId, instanceId);
    expect(await repository!.listForPlayer(playerId)).toEqual([]);
    const remaining = await pool!.query("SELECT 1 FROM planned_routes WHERE quest_instance_id = $1", [instanceId]);
    expect(remaining.rowCount).toBe(0);
  });
});
