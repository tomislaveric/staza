import { createInterface } from "node:readline/promises";
import { rm } from "node:fs/promises";
import path from "node:path";
import { stdin, stdout } from "node:process";
import type { Pool } from "pg";
import { config } from "../config.js";
import { createDatabasePool } from "./database.js";
import { mediaDirectoryFor } from "./mediaCleanup.js";
import { migrate } from "./migrate.js";

export type UserDataCleanupScope = { mode: "users"; emails: string[] } | { mode: "all" };

export interface UserDataCleanupResult {
  users: number;
  activities: number;
  quests: number;
  questInstances: number;
  securityEvents: number;
  mediaDirectories: string[];
}

const count = async (client: { query: Pool["query"] }, sql: string, values: unknown[] = []): Promise<number> =>
  Number((await client.query<{ count: string }>(sql, values)).rows[0]?.count ?? 0);

/** Deletes user-owned rows transactionally; shared catalogs (fartleks, collectibles, quest templates) are untouched. */
export const cleanUserData = async (pool: Pool, scope: UserDataCleanupScope, mediaRoot: string): Promise<UserDataCleanupResult> => {
  const emails = scope.mode === "users" ? [...new Set(scope.emails.map((email) => email.trim().toLowerCase()))] : [];
  if (scope.mode === "users" && emails.length === 0) throw new Error("At least one email is required.");

  const client = await pool.connect();
  let result: UserDataCleanupResult;
  try {
    await client.query("BEGIN");
    const all = scope.mode === "all";
    const users = await client.query<{ id: string }>(
      all ? "SELECT id FROM users FOR UPDATE" : "SELECT id FROM users WHERE lower(email) = ANY($1) FOR UPDATE",
      all ? [] : [emails]
    );
    const userIds = users.rows.map((user) => user.id);
    const players = await client.query<{ id: string }>(
      all ? "SELECT id FROM players" : "SELECT id FROM players WHERE user_id = ANY($1)",
      all ? [] : [userIds]
    );
    const playerIds = players.rows.map((player) => player.id);
    const videos = await client.query<{ source_path: string; output_path: string | null }>(
      `SELECT video.source_path, video.output_path FROM activity_videos AS video
       INNER JOIN activities ON activities.id = video.activity_id
       WHERE ($1::boolean OR activities.player_id = ANY($2))`,
      [all, playerIds]
    );
    const mediaDirectories = [...new Set(videos.rows.flatMap((video) =>
      [video.source_path, ...(video.output_path ? [video.output_path] : [])].map((file) => mediaDirectoryFor(file, mediaRoot))
    ))];

    result = {
      users: userIds.length,
      activities: await count(client, "SELECT count(*) FROM activities WHERE $1::boolean OR player_id = ANY($2)", [all, playerIds]),
      quests: await count(client, "SELECT count(*) FROM quests WHERE $1::boolean OR created_by_player_id = ANY($2)", [all, playerIds]),
      questInstances: await count(client, "SELECT count(*) FROM quest_instances WHERE $1::boolean OR player_id = ANY($2)", [all, playerIds]),
      securityEvents: await count(client, "SELECT count(*) FROM security_events WHERE $1::boolean OR user_id = ANY($2)", [all, userIds]),
      mediaDirectories
    };

    if (all) {
      await client.query("DELETE FROM players");
      await client.query("DELETE FROM users");
      await client.query("DELETE FROM security_events");
      await client.query("DELETE FROM email_codes");
      await client.query("DELETE FROM auth_challenges");
      await client.query("DELETE FROM auth_rate_limits");
      await client.query("DELETE FROM deletion_intents");
      await client.query("DELETE FROM media_cleanup_tasks");
    } else {
      await client.query("DELETE FROM players WHERE id = ANY($1)", [playerIds]);
      await client.query("DELETE FROM email_codes WHERE lower(email) = ANY($1)", [emails]);
      await client.query("DELETE FROM users WHERE id = ANY($1)", [userIds]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await Promise.all(result.mediaDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
  return result;
};

const usage = "Usage: npm run clean:user-data -- --all | --email user@example.com [--email other@example.com]";

const parseScope = (args: string[]): UserDataCleanupScope => {
  const emails: string[] = [];
  let all = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--all") all = true;
    else if (args[index] === "--email" && args[index + 1]) emails.push(args[++index]);
    else throw new Error(usage);
  }
  if (all === (emails.length > 0)) throw new Error(usage);
  return all ? { mode: "all" } : { mode: "users", emails };
};

const run = async (): Promise<void> => {
  if (config.nodeEnv === "production") throw new Error("clean:user-data is disabled when NODE_ENV=production.");
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required.");
  const scope = parseScope(process.argv.slice(2));

  const databaseHost = new URL(config.databaseUrl).host || "local database";
  const target = scope.mode === "all" ? "ALL user accounts" : `account(s) ${scope.emails.join(", ")}`;
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await prompt.question(
      `This permanently deletes ${target} in ${databaseHost} with their players, activities, quests, progress, Strava connections, sessions, security events, and media files. Shared catalogs (fartleks, collectibles, quest templates) are preserved. Type "delete" to continue: `
    );
    if (answer !== "delete") {
      console.log("User data cleanup cancelled.");
      return;
    }
  } finally {
    prompt.close();
  }

  const pool = createDatabasePool(config.databaseUrl);
  try {
    await migrate(pool);
    const result = await cleanUserData(pool, scope, path.resolve(config.mediaDir));
    console.log(
      `Deleted ${result.users} users, ${result.activities} activities, ${result.quests} authored quests, ${result.questInstances} quest instances, ${result.securityEvents} security events, and ${result.mediaDirectories.length} media directories.`
    );
  } finally {
    await pool.end();
  }
};

if (process.argv[1]?.includes("cleanUserData.")) {
  await run();
}
