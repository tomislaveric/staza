import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Activity, ActivityResult, Collectible } from "../domain.js";
import { createDatabasePool } from "./database.js";
import { ActivityRepository } from "./activityRepository.js";
import { CollectibleRepository } from "./collectibleRepository.js";
import { QuestNotFoundError, QuestRepository } from "./questRepository.js";
import { createQuestRouteSnapshot } from "../quest.js";
import { migrate } from "./migrate.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describePersistence = databaseUrl ? describe : describe.skip;
const creatorId = "00000000-0000-4000-8000-0000000000a1";
const otherPlayerId = "00000000-0000-4000-8000-0000000000a2";
const pool = databaseUrl ? createDatabasePool(databaseUrl) : undefined;
const collectibles = pool ? new CollectibleRepository(pool) : undefined;
const quests = pool ? new QuestRepository(pool) : undefined;
const activities = pool ? new ActivityRepository(pool) : undefined;

const catalog: Collectible[] = [
  { id: "turmberg", name: "Turmberg", type: "landmark", rarity: "epic", latitude: 48.9995, longitude: 8.4905, radiusMeters: 40, value: 50 },
  { id: "schloss", name: "Schloss", type: "landmark", rarity: "rare", latitude: 49.0134, longitude: 8.4044, radiusMeters: 30, value: 25 },
  { id: "rheinhafen", name: "Rheinhafen", type: "coin", latitude: 49.0169, longitude: 8.3305, radiusMeters: 20, value: 10 },
  { id: "freiburg-muenster", name: "Freiburg Münster", type: "landmark", latitude: 47.9955, longitude: 7.8522, radiusMeters: 30, value: 20 }
];

const karlsruhe = { minLatitude: 48.9, maxLatitude: 49.1, minLongitude: 8.3, maxLongitude: 8.5 };
const freiburg = { minLatitude: 47.9, maxLatitude: 48.1, minLongitude: 7.7, maxLongitude: 8.0 };

const activity = (id: string): Activity => ({
  id,
  source: "fit",
  type: "cycling",
  startedAt: Date.parse("2026-02-12T09:00:00.000Z"),
  endedAt: Date.parse("2026-02-12T10:00:00.000Z"),
  route: [
    { latitude: 49.0134, longitude: 8.4044, timestampMs: Date.parse("2026-02-12T09:00:00.000Z") },
    { latitude: 48.9995, longitude: 8.4905, timestampMs: Date.parse("2026-02-12T10:00:00.000Z") }
  ],
  distance: 9_400,
  duration: 3_600
});

const result = (activityId: string): ActivityResult => ({
  activityId,
  distance: 9_400,
  duration: 3_600,
  collectedCount: 1,
  totalPoints: 25,
  collectibles: [catalog[1]],
  events: [{
    id: "schloss",
    sourceId: "schloss",
    type: "collectible_collected",
    collectible: { name: "Schloss", type: "landmark", rarity: "rare" },
    value: 25,
    latitude: 49.0134,
    longitude: 8.4044,
    activityTimestamp: Date.parse("2026-02-12T09:10:00.000Z")
  }],
  nearMisses: [],
  fartlekCompletions: []
});

describePersistence("World catalog and quests", () => {
  beforeEach(async () => {
    await migrate(pool!);
    await pool!.query("TRUNCATE quest_routes, quest_collectibles, quests, collectibles, activity_events, activities, players CASCADE");
    await pool!.query("INSERT INTO players (id, display_name) VALUES ($1, $2), ($3, $4)", [
      creatorId, "Creator", otherPlayerId, "Explorer"
    ]);
    await collectibles!.upsertMany(catalog);
  });

  afterAll(async () => {
    await pool?.end();
  });

  describe("collectible catalog", () => {
    it("seeds idempotently and updates curated data in place", async () => {
      await collectibles!.upsertMany(catalog);
      expect((await collectibles!.listAll())).toHaveLength(4);

      await collectibles!.upsertMany([{ ...catalog[0], name: "Turmberg viewpoint", value: 60 }]);
      const updated = (await collectibles!.listAll()).find((item) => item.id === "turmberg");
      expect(updated?.name).toBe("Turmberg viewpoint");
      expect(updated?.value).toBe(60);
      expect(await collectibles!.listAll()).toHaveLength(4);
    });

    it("returns only the collectibles inside a viewport", async () => {
      const near = await collectibles!.listWithinBounds(karlsruhe, 300);
      expect(near.collectibles.map((item) => item.id).sort()).toEqual(["rheinhafen", "schloss", "turmberg"]);
      expect(near.truncated).toBe(false);

      const south = await collectibles!.listWithinBounds(freiburg, 300);
      expect(south.collectibles.map((item) => item.id)).toEqual(["freiburg-muenster"]);
    });

    it("returns an empty viewport without failing", async () => {
      const empty = await collectibles!.listWithinBounds(
        { minLatitude: 10, maxLatitude: 11, minLongitude: 10, maxLongitude: 11 }, 300
      );
      expect(empty).toEqual({ collectibles: [], truncated: false });
    });

    it("caps a dense viewport and reports truncation", async () => {
      const capped = await collectibles!.listWithinBounds(karlsruhe, 2);
      expect(capped.collectibles).toHaveLength(2);
      expect(capped.truncated).toBe(true);
    });

    it("keeps historical events readable after a collectible leaves the catalog", async () => {
      const id = "b".repeat(48);
      await activities!.persistCompletedActivity(creatorId, activity(id), result(id));
      await pool!.query("DELETE FROM collectibles WHERE id = 'schloss'");
      expect(await activities!.listDiscoveredCollectibleSourceIds(creatorId)).toEqual(["schloss"]);
    });
  });

  describe("quest lifecycle", () => {
    it("creates a draft that only the creator can see and publishes it to everyone", async () => {
      const questId = await quests!.create(creatorId, {
        title: "Best viewpoints",
        description: "Ridge loop",
        collectibleIds: ["turmberg", "schloss"]
      });

      expect(await quests!.listWithinBounds(creatorId, karlsruhe, [], 300)).toHaveLength(1);
      expect(await quests!.listWithinBounds(otherPlayerId, karlsruhe, [], 300)).toEqual([]);
      await expect(quests!.get(otherPlayerId, questId, [])).rejects.toBeInstanceOf(QuestNotFoundError);

      await quests!.setStatus(creatorId, questId, "published");
      const discovered = await quests!.listWithinBounds(otherPlayerId, karlsruhe, [], 300);
      expect(discovered.map((quest) => quest.title)).toEqual(["Best viewpoints"]);
      expect(discovered[0].isOwner).toBe(false);
      expect(discovered[0].createdBy).toBe("Creator");
    });

    it("places a quest by its collectibles so viewport discovery works", async () => {
      const questId = await quests!.create(creatorId, { title: "Karlsruhe", collectibleIds: ["schloss"] });
      await quests!.setStatus(creatorId, questId, "published");
      expect(await quests!.listWithinBounds(otherPlayerId, karlsruhe, [], 300)).toHaveLength(1);
      expect(await quests!.listWithinBounds(otherPlayerId, freiburg, [], 300)).toEqual([]);
    });

    it("derives progress per player from canonical collectible history", async () => {
      const questId = await quests!.create(creatorId, { title: "Two stops", collectibleIds: ["turmberg", "schloss"] });
      await quests!.setStatus(creatorId, questId, "published");

      const partial = await quests!.get(otherPlayerId, questId, ["schloss"]);
      expect(partial.progress).toEqual({ collected: 1, total: 2, ratio: 0.5, complete: false });
      expect(partial.collectibles.find((item) => item.id === "schloss")?.found).toBe(true);
      expect(partial.collectibles.find((item) => item.id === "turmberg")?.found).toBe(false);

      const none = await quests!.get(creatorId, questId, []);
      expect(none.progress.collected).toBe(0);

      const complete = await quests!.get(otherPlayerId, questId, ["schloss", "turmberg"]);
      expect(complete.progress.complete).toBe(true);
    });

    it("rejects collectibles that are not in the catalog", async () => {
      await expect(quests!.create(creatorId, { title: "Bad", collectibleIds: ["does-not-exist"] }))
        .rejects.toThrow();
    });

    it("refuses to remove a collectible that a quest still references", async () => {
      await quests!.create(creatorId, { title: "Keeps turmberg", collectibleIds: ["turmberg"] });
      await expect(pool!.query("DELETE FROM collectibles WHERE id = 'turmberg'")).rejects.toThrow();
    });

    it("lets only the creator edit, publish, and delete", async () => {
      const questId = await quests!.create(creatorId, { title: "Mine", collectibleIds: ["schloss"] });
      await expect(quests!.update(otherPlayerId, questId, { title: "Stolen" }))
        .rejects.toBeInstanceOf(QuestNotFoundError);
      await expect(quests!.setStatus(otherPlayerId, questId, "published"))
        .rejects.toBeInstanceOf(QuestNotFoundError);
      await expect(quests!.remove(otherPlayerId, questId)).rejects.toBeInstanceOf(QuestNotFoundError);
      expect((await quests!.get(creatorId, questId, [])).title).toBe("Mine");
    });

    it("edits title, description, and collectibles", async () => {
      const questId = await quests!.create(creatorId, { title: "Draft", collectibleIds: ["schloss"] });
      await quests!.update(creatorId, questId, {
        title: "Edited",
        description: "Now updated",
        collectibleIds: ["turmberg", "rheinhafen"]
      });
      const edited = await quests!.get(creatorId, questId, []);
      expect(edited.title).toBe("Edited");
      expect(edited.description).toBe("Now updated");
      expect(edited.collectibles.map((item) => item.id).sort()).toEqual(["rheinhafen", "turmberg"]);
    });

    it("recentres a quest when its collectibles change", async () => {
      const questId = await quests!.create(creatorId, { title: "Moves", collectibleIds: ["schloss"] });
      await quests!.setStatus(creatorId, questId, "published");
      await quests!.update(creatorId, questId, {
        collectibleIds: ["freiburg-muenster"]
      });
      expect(await quests!.listWithinBounds(otherPlayerId, karlsruhe, [], 300)).toEqual([]);
      expect(await quests!.listWithinBounds(otherPlayerId, freiburg, [], 300)).toHaveLength(1);
    });

    it("hides a quest again when it is unpublished", async () => {
      const questId = await quests!.create(creatorId, { title: "Temporary", collectibleIds: ["schloss"] });
      await quests!.setStatus(creatorId, questId, "published");
      await quests!.setStatus(creatorId, questId, "draft");
      expect(await quests!.listWithinBounds(otherPlayerId, karlsruhe, [], 300)).toEqual([]);
    });
  });

  describe("activity to quest", () => {
    const activityId = "c".repeat(48);

    const createQuestFromActivity = async () => {
      const persisted = await activities!.getActivity(creatorId, activityId);
      const route = createQuestRouteSnapshot(persisted!.replay!.activity, 2000);
      return quests!.create(creatorId, {
        title: "Ride · 12 Feb",
        sourceActivityId: activityId,
        collectibleIds: persisted!.events.map((event) => event.sourceId),
        route
      });
    };

    beforeEach(async () => {
      await activities!.persistCompletedActivity(creatorId, activity(activityId), result(activityId));
    });

    it("stores a route snapshot and leaves the source activity untouched", async () => {
      const before = await activities!.getActivity(creatorId, activityId);
      const xpBefore = await pool!.query<{ total_xp: number }>("SELECT total_xp FROM players WHERE id = $1", [creatorId]);
      const eventsBefore = await pool!.query("SELECT * FROM activity_events WHERE activity_id = $1", [activityId]);

      const questId = await createQuestFromActivity();
      const quest = await quests!.get(creatorId, questId, []);

      expect(quest.sourceActivityId).toBe(activityId);
      expect(quest.route?.geometry.coordinates).toEqual([[8.4044, 49.0134], [8.4905, 48.9995]]);
      expect(quest.route?.distanceMeters).toBe(9_400);
      expect(quest.route?.activityType).toBe("cycling");
      expect(quest.collectibles.map((item) => item.id)).toEqual(["schloss"]);

      const after = await activities!.getActivity(creatorId, activityId);
      expect(after).toEqual(before);
      const xpAfter = await pool!.query<{ total_xp: number }>("SELECT total_xp FROM players WHERE id = $1", [creatorId]);
      expect(xpAfter.rows[0].total_xp).toBe(xpBefore.rows[0].total_xp);
      const eventsAfter = await pool!.query("SELECT * FROM activity_events WHERE activity_id = $1", [activityId]);
      expect(eventsAfter.rows).toEqual(eventsBefore.rows);
      expect(eventsAfter.rowCount).toBe(1);
    });

    it("keeps the published route usable after the source activity is deleted", async () => {
      const questId = await createQuestFromActivity();
      await quests!.setStatus(creatorId, questId, "published");
      await pool!.query("DELETE FROM activities WHERE id = $1", [activityId]);

      const quest = await quests!.get(otherPlayerId, questId, []);
      expect(quest.route?.geometry.coordinates).toHaveLength(2);
      expect(quest.route?.sourceActivityId).toBeUndefined();
      expect(quest.sourceActivityId).toBeUndefined();
    });

    it("gives a second player independent progress on the published quest", async () => {
      const questId = await createQuestFromActivity();
      await quests!.setStatus(creatorId, questId, "published");

      const creatorView = await quests!.get(
        creatorId, questId, await activities!.listDiscoveredCollectibleSourceIds(creatorId)
      );
      const explorerView = await quests!.get(
        otherPlayerId, questId, await activities!.listDiscoveredCollectibleSourceIds(otherPlayerId)
      );
      expect(creatorView.progress.complete).toBe(true);
      expect(explorerView.progress).toEqual({ collected: 0, total: 1, ratio: 0, complete: false });
    });
  });
});
