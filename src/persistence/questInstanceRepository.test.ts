import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { QuestSuggestion } from "../domain.js";
import { createDatabasePool } from "./database.js";
import { migrate } from "./migrate.js";
import { QuestInstanceRepository } from "./questInstanceRepository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describePersistence = databaseUrl ? describe : describe.skip;
const playerId = "00000000-0000-4000-8000-0000000000e1";
const pool = databaseUrl ? createDatabasePool(databaseUrl) : undefined;
const repository = pool ? new QuestInstanceRepository(pool) : undefined;

const suggestion: QuestSuggestion = {
  id: "a".repeat(32),
  templateId: "history-peak-test",
  templateVersion: 1,
  title: "Peak collection",
  description: "Discover three peaks.",
  recommendedLevel: 2,
  objectives: [{
    id: "peaks",
    type: "collectible_count",
    requiredCount: 3,
    category: "peak",
    targets: [
      { id: "peak-a", name: "Peak A" },
      { id: "peak-b", name: "Peak B" },
      { id: "peak-c", name: "Peak C" },
      { id: "peak-d", name: "Peak D" }
    ]
  }]
};

const insertActivity = async (id: string): Promise<void> => {
  await pool!.query(
    `INSERT INTO activities (
      id, player_id, source_type, activity_type, started_at, xp_earned, collected_count
    ) VALUES ($1, $2, 'fit', 'cycling', now(), 0, 0)`,
    [id, playerId]
  );
};

const insertDiscovery = async (activityId: string, sourceId: string): Promise<void> => {
  await pool!.query(
    `INSERT INTO activity_events (
      id, activity_id, source_id, event_type, activity_timestamp, value, latitude, longitude,
      collectible_name, collectible_type, collectible_category
    ) VALUES ($1, $2, $3, 'collectible_collected', 1, 10, 49, 8, $3, 'landmark', 'peak')`,
    [randomUUID(), activityId, sourceId]
  );
};

describePersistence("QuestInstanceRepository", () => {
  beforeEach(async () => {
    await migrate(pool!);
    await pool!.query("TRUNCATE quest_instances, activity_events, activities, players CASCADE");
    await pool!.query("INSERT INTO players (id, display_name) VALUES ($1, 'Quest test player')", [playerId]);
    await pool!.query(
      `INSERT INTO quest_templates (id, version, title, description, recommended_level, objectives, active)
       VALUES ($1, 1, $2, $3, 2, $4, true)
       ON CONFLICT (id, version) DO UPDATE SET active = true`,
      [
        suggestion.templateId,
        suggestion.title,
        suggestion.description,
        JSON.stringify([{ type: "collectible_count", requiredCount: 3, category: "peak" }])
      ]
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("starts idempotently, counts pre-start history, and persists completion from all-time progress", async () => {
    await insertActivity("history-activity-1");
    await insertDiscovery("history-activity-1", "peak-a");
    await insertDiscovery("history-activity-1", "peak-b");

    const resolvedSuggestion = structuredClone(suggestion);
    const instanceId = await repository!.start(playerId, resolvedSuggestion);
    resolvedSuggestion.objectives[0].targets.pop();
    expect(await repository!.start(playerId, suggestion)).toBe(instanceId);
    let instances = await repository!.listForPlayer(playerId);
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({
      id: instanceId,
      suggestionId: suggestion.id,
      status: "active",
      objectives: [{
        objective: { targets: [{ id: "peak-a" }, { id: "peak-b" }, { id: "peak-c" }, { id: "peak-d" }] },
        progress: { completed: 2, required: 3, complete: false }
      }]
    });

    await insertActivity("history-activity-2");
    await insertDiscovery("history-activity-2", "peak-c");
    instances = await repository!.listForPlayer(playerId);
    expect(instances[0].status).toBe("completed");
    expect(instances[0].completedAt).toBeDefined();
    expect(instances[0].objectives[0].progress.complete).toBe(true);
  });

  it("can complete immediately from history recorded before the quest was started", async () => {
    await insertActivity("history-activity-3");
    for (const target of ["peak-a", "peak-b", "peak-c"]) {
      await insertDiscovery("history-activity-3", target);
    }

    const instanceId = await repository!.start(playerId, suggestion);
    const instance = (await repository!.listForPlayer(playerId)).find((item) => item.id === instanceId);
    expect(instance?.status).toBe("completed");
    expect(instance?.completedAt).toBeDefined();
  });
});
