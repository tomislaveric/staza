import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { cleanUserData } from "./cleanUserData.js";
import { createDatabasePool } from "./database.js";
import { migrate } from "./migrate.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeCleanup = databaseUrl ? describe : describe.skip;
const pool = databaseUrl ? createDatabasePool(databaseUrl) : undefined;
const mediaRoot = "/tmp/staza-clean-user-data-media";

const seedUser = async (email: string): Promise<{ userId: string; playerId: string }> => {
  const userId = randomUUID();
  const playerId = randomUUID();
  await pool!.query("INSERT INTO users (id, email, email_verified_at) VALUES ($1, $2, now())", [userId, email]);
  await pool!.query("INSERT INTO players (id, user_id, display_name) VALUES ($1, $2, $3)", [playerId, userId, email]);
  await pool!.query(
    `INSERT INTO activities (id, player_id, source_type, started_at, xp_earned, collected_count)
     VALUES ($1, $2, 'fit', now(), 0, 0)`,
    [`activity-${playerId}`, playerId]
  );
  await pool!.query(
    `INSERT INTO activity_videos (activity_id, media_id, source_filename, source_path, state)
     VALUES ($1, $2, 'source.mp4', $3, 'syncing')`,
    [`activity-${playerId}`, randomUUID(), `${mediaRoot}/${playerId}/media/source.mp4`]
  );
  await pool!.query("INSERT INTO security_events (id, user_id, event_type, success) VALUES ($1, $2, 'login', true)", [randomUUID(), userId]);
  return { userId, playerId };
};

const rows = async (table: string): Promise<number> => (await pool!.query(`SELECT 1 FROM ${table}`)).rowCount ?? 0;

describeCleanup("cleanUserData", () => {
  beforeEach(async () => {
    await migrate(pool!);
    await pool!.query("TRUNCATE security_events, players, users CASCADE");
    await pool!.query(
      `INSERT INTO collectibles (id, name, collectible_type, latitude, longitude, radius_meters, value)
       VALUES ('clean-test-collectible', 'Shared', 'landmark', 49, 8, 100, 1)
       ON CONFLICT (id) DO NOTHING`
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("deletes only the selected accounts and their data", async () => {
    const keep = await seedUser("keep@example.test");
    await seedUser("drop@example.test");

    const result = await cleanUserData(pool!, { mode: "users", emails: ["DROP@example.test"] }, mediaRoot);

    expect(result).toMatchObject({ users: 1, activities: 1, securityEvents: 1 });
    expect((await pool!.query("SELECT id FROM users")).rows).toEqual([{ id: keep.userId }]);
    expect(await rows("activities")).toBe(1);
    expect(await rows("security_events")).toBe(1);
  });

  it("purges all user-owned data and keeps shared catalogs", async () => {
    await seedUser("a@example.test");
    await seedUser("b@example.test");

    const result = await cleanUserData(pool!, { mode: "all" }, mediaRoot);

    expect(result).toMatchObject({ users: 2, activities: 2, securityEvents: 2 });
    for (const table of ["users", "players", "activities", "security_events"]) expect(await rows(table)).toBe(0);
    expect(await pool!.query("SELECT id FROM collectibles WHERE id = 'clean-test-collectible'")).toMatchObject({ rowCount: 1 });
  });

  it("refuses media outside the media root without deleting data", async () => {
    await seedUser("outside@example.test");

    await expect(cleanUserData(pool!, { mode: "all" }, "/tmp/other-root")).rejects.toThrow(/outside MEDIA_DIR/);
    expect(await rows("users")).toBe(1);
  });
});
