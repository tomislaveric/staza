import type { PoolClient } from "pg";
import type { CollectibleCategory } from "../domain.js";
import { getLevelForXp } from "../progression.js";
import type { SkillTreeStats } from "./types.js";

/**
 * Aggregate durable Skill Tree stats for a player using the provided client, so
 * the same read can run inside a larger transaction (e.g. an unlock). Does not
 * manage its own transaction.
 */
export const aggregateSkillTreeStats = async (
  client: PoolClient,
  playerId: string
): Promise<SkillTreeStats> => {
  const player = await client.query<{ total_xp: number }>(
    "SELECT total_xp FROM players WHERE id = $1",
    [playerId]
  );
  if (player.rowCount !== 1) throw new Error("Player does not exist.");

  const activityStats = await client.query<{
    total_distance_m: number;
    cycling_distance_m: number;
    running_distance_m: number;
    longest_ride_m: number;
    longest_run_m: number;
    activity_count: string;
  }>(
    `SELECT
       COALESCE(SUM(distance_meters), 0) AS total_distance_m,
       COALESCE(SUM(distance_meters) FILTER (WHERE activity_type = 'cycling'), 0) AS cycling_distance_m,
       COALESCE(SUM(distance_meters) FILTER (WHERE activity_type = 'running'), 0) AS running_distance_m,
       COALESCE(MAX(distance_meters) FILTER (WHERE activity_type = 'cycling'), 0) AS longest_ride_m,
       COALESCE(MAX(distance_meters) FILTER (WHERE activity_type = 'running'), 0) AS longest_run_m,
       COUNT(*) AS activity_count
     FROM activities WHERE player_id = $1`,
    [playerId]
  );

  const flowlines = await client.query<{ unique_flowlines: string }>(
    "SELECT COUNT(DISTINCT fartlek_id) AS unique_flowlines FROM fartlek_completions WHERE player_id = $1",
    [playerId]
  );

  const categories = await client.query<{ collectible_category: CollectibleCategory | null; unique_count: string }>(
    `SELECT events.collectible_category, COUNT(DISTINCT events.source_id) AS unique_count
     FROM activity_events AS events
     INNER JOIN activities ON activities.id = events.activity_id
     WHERE activities.player_id = $1
     GROUP BY events.collectible_category`,
    [playerId]
  );

  const activityRow = activityStats.rows[0];
  const categoryCounts = { viewpoint: 0, peak: 0, castle: 0, waterfall: 0, place: 0, mountain_pass: 0 };
  let uniqueCollectibles = 0;
  for (const row of categories.rows) {
    const count = Number(row.unique_count);
    uniqueCollectibles += count;
    if (row.collectible_category && row.collectible_category in categoryCounts) {
      categoryCounts[row.collectible_category] = count;
    }
  }

  const totalXp = Number(player.rows[0].total_xp);
  return {
    totalXp,
    level: getLevelForXp(totalXp),
    totalDistanceM: Number(activityRow.total_distance_m),
    cyclingDistanceM: Number(activityRow.cycling_distance_m),
    runningDistanceM: Number(activityRow.running_distance_m),
    longestRideM: Number(activityRow.longest_ride_m),
    longestRunM: Number(activityRow.longest_run_m),
    activityCount: Number(activityRow.activity_count),
    uniqueFlowlines: Number(flowlines.rows[0].unique_flowlines),
    categoryCounts,
    uniqueCollectibles
  };
};
