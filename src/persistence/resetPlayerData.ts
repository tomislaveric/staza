import { rm } from "node:fs/promises";
import type { Pool } from "pg";
import { mediaDirectoryFor } from "./mediaCleanup.js";

export interface PlayerDataResetResult {
  activities: number;
  mediaDirectories: number;
}

const playerOwnedTables = [
  "fartlek_completions",
  "quest_instances",
  "quest_instance_cancellations",
  "planned_routes",
  "skill_tree_unlocks",
  "authored_quest_attempts",
  "authored_quest_completions"
];

/** Wipes a player's game data and media but keeps the user, auth credentials, Strava connection and the player row. */
export const resetPlayerData = async (pool: Pool, playerId: string, mediaRoot: string): Promise<PlayerDataResetResult> => {
  const client = await pool.connect();
  let activities = 0;
  let directories: string[];
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM players WHERE id = $1 FOR UPDATE", [playerId]);
    const videos = await client.query<{ source_path: string; output_path: string | null }>(
      `SELECT video.source_path, video.output_path FROM activity_videos AS video
       INNER JOIN activities ON activities.id = video.activity_id
       WHERE activities.player_id = $1`,
      [playerId]
    );
    directories = [...new Set(videos.rows.flatMap((video) =>
      [video.source_path, ...(video.output_path ? [video.output_path] : [])].map((file) => mediaDirectoryFor(file, mediaRoot))
    ))];
    for (const table of playerOwnedTables) await client.query(`DELETE FROM ${table} WHERE player_id = $1`, [playerId]);
    await client.query("DELETE FROM quests WHERE created_by_player_id = $1", [playerId]);
    activities = (await client.query("DELETE FROM activities WHERE player_id = $1", [playerId])).rowCount ?? 0;
    await client.query("UPDATE players SET total_xp = 0, journey_started_at = NULL WHERE id = $1", [playerId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
  return { activities, mediaDirectories: directories.length };
};
