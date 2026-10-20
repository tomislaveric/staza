import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabasePool } from "./database.js";
import { SkillTreeRepository, SkillTreeUnlockError } from "./skillTreeRepository.js";
import { migrate } from "./migrate.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describePersistence = databaseUrl ? describe : describe.skip;
const playerId = "00000000-0000-4000-8000-000000000098";
const pool = databaseUrl ? createDatabasePool(databaseUrl) : undefined;
const repository = pool ? new SkillTreeRepository(pool) : undefined;

// Give the player enough XP (level 8 => 3 skill points) and one cycling activity
// so Tier-1 requirements are reachable.
const seedPlayer = async (totalXp: number, isPremium: boolean): Promise<void> => {
  await pool!.query(
    "INSERT INTO players (id, display_name, total_xp, is_premium) VALUES ($1, $2, $3, $4)",
    [playerId, "Skill tree test player", totalXp, isPremium]
  );
};

const seedActivity = async (id: string, type: string, distanceMeters: number): Promise<void> => {
  await pool!.query(
    `INSERT INTO activities (id, player_id, source_type, activity_type, started_at, distance_meters, duration_seconds, xp_earned, collected_count)
     VALUES ($1, $2, 'fit', $3, now(), $4, 600, 0, 0)`,
    [id, playerId, type, distanceMeters]
  );
};

describePersistence("SkillTreeRepository", () => {
  beforeEach(async () => {
    await migrate(pool!);
    await pool!.query("TRUNCATE skill_tree_unlocks, activity_events, activities, players CASCADE");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("unlocks an eligible tier-1 node once and is idempotent", async () => {
    await seedPlayer(800, false); // level 8 => 3 SP
    await seedActivity("a1", "cycling", 1000);

    const first = await repository!.unlockNode(playerId, "cyclist");
    expect(first.created).toBe(true);
    expect(first.view.spentPoints).toBe(1);
    expect(first.view.balance).toBe(2);

    const second = await repository!.unlockNode(playerId, "cyclist");
    expect(second.created).toBe(false);
    expect(second.view.spentPoints).toBe(1);

    const rows = await pool!.query("SELECT count(*) AS c FROM skill_tree_unlocks WHERE player_id = $1", [playerId]);
    expect(Number(rows.rows[0].c)).toBe(1);
  });

  it("rejects unlocking without enough skill points", async () => {
    await seedPlayer(100, false); // level 2 => 1 SP
    await seedActivity("a1", "cycling", 1000);
    await repository!.unlockNode(playerId, "cyclist"); // spends the only point

    // adventurer-i is eligible by requirement path only after cyclist, but no points remain
    await expect(repository!.unlockNode(playerId, "adventurer-i")).rejects.toMatchObject({
      code: "insufficient_points"
    });
  });

  it("rejects a premium node for free players and allows it for premium", async () => {
    await seedPlayer(100000, false); // high level, many SP
    await seedActivity("a1", "cycling", 1000);
    await repository!.unlockNode(playerId, "cyclist");

    // rusher-ii is premium (tier 2); free players are blocked by the premium gate first.
    const freeRejection = await repository!.unlockNode(playerId, "rusher-ii").catch((error) => error);
    expect(freeRejection).toBeInstanceOf(SkillTreeUnlockError);
    expect((freeRejection as SkillTreeUnlockError).code).toBe("premium_required");

    // Premium players pass the premium gate; the next unmet gate is the missing prerequisite.
    await pool!.query("UPDATE players SET is_premium = true WHERE id = $1", [playerId]);
    const premiumRejection = await repository!.unlockNode(playerId, "rusher-ii").catch((error) => error);
    expect(premiumRejection).toBeInstanceOf(SkillTreeUnlockError);
    expect((premiumRejection as SkillTreeUnlockError).code).toBe("prerequisite_locked");
  });

  it("rejects an unknown node", async () => {
    await seedPlayer(800, true);
    await expect(repository!.unlockNode(playerId, "does-not-exist")).rejects.toMatchObject({
      code: "unknown_node"
    });
  });

  it("exposes unlocked capabilities and cascades on player deletion", async () => {
    await seedPlayer(800, true);
    await seedActivity("a1", "cycling", 1000);
    await repository!.unlockNode(playerId, "cyclist");

    const capabilities = await repository!.getUnlockedCapabilities(playerId);
    expect(capabilities).toEqual([{ type: "tree_access", value: "cycling-branches", label: expect.any(String) }]);

    await pool!.query("DELETE FROM players WHERE id = $1", [playerId]);
    const rows = await pool!.query("SELECT count(*) AS c FROM skill_tree_unlocks WHERE player_id = $1", [playerId]);
    expect(Number(rows.rows[0].c)).toBe(0);
  });
});
