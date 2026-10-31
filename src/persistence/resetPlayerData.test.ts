import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabasePool } from "./database.js";
import { migrate } from "./migrate.js";
import { resetPlayerData } from "./resetPlayerData.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeReset = databaseUrl ? describe : describe.skip;
const pool = databaseUrl ? createDatabasePool(databaseUrl) : undefined;
const mediaRoot = "/tmp/staza-reset-player-data-media";

const seed = async (email: string): Promise<{ userId: string; playerId: string }> => {
  const userId = randomUUID();
  const playerId = randomUUID();
  await pool!.query("INSERT INTO users (id, email, email_verified_at) VALUES ($1, $2, now())", [userId, email]);
  await pool!.query("INSERT INTO players (id, user_id, display_name, total_xp) VALUES ($1, $2, $3, 500)", [playerId, userId, email]);
  await pool!.query(
    "INSERT INTO activities (id, player_id, source_type, started_at, xp_earned, collected_count) VALUES ($1, $2, 'fit', now(), 0, 0)",
    [`activity-${playerId}`, playerId]
  );
  return { userId, playerId };
};

describeReset("resetPlayerData", () => {
  beforeEach(async () => {
    await migrate(pool!);
    await pool!.query("TRUNCATE security_events, players, users CASCADE");
  });
  afterAll(async () => { await pool?.end(); });

  it("wipes the player's game data but keeps the login and other players", async () => {
    const mine = await seed("mine@example.test");
    const other = await seed("other@example.test");

    const result = await resetPlayerData(pool!, mine.playerId, mediaRoot);

    expect(result.activities).toBe(1);
    expect((await pool!.query("SELECT 1 FROM activities WHERE player_id = $1", [mine.playerId])).rowCount).toBe(0);
    expect((await pool!.query("SELECT 1 FROM activities WHERE player_id = $1", [other.playerId])).rowCount).toBe(1);
    expect((await pool!.query("SELECT 1 FROM users WHERE id = $1", [mine.userId])).rowCount).toBe(1);
    const player = await pool!.query<{ total_xp: number }>("SELECT total_xp FROM players WHERE id = $1", [mine.playerId]);
    expect(player.rows[0].total_xp).toBe(0);
  });
});
