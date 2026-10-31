import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { readSkillTreeView } from "./activityOutcome.js";

describe("readSkillTreeView", () => {
  it("does not overlap queries on the transaction client", async () => {
    let activeQueries = 0;
    let maxConcurrentQueries = 0;
    const client = {
      async query(query: string) {
        activeQueries += 1;
        maxConcurrentQueries = Math.max(maxConcurrentQueries, activeQueries);
        await new Promise((resolve) => setTimeout(resolve, 0));
        activeQueries -= 1;

        if (query.startsWith("SELECT total_xp FROM players")) {
          return { rows: [{ total_xp: 0 }], rowCount: 1 };
        }
        if (query.includes("AS unique_flowlines")) {
          return { rows: [{ unique_flowlines: "0" }], rowCount: 1 };
        }
        if (query.includes("GROUP BY activities.activity_type")) {
          return { rows: [], rowCount: 0 };
        }
        if (query.includes("SELECT node_id FROM skill_tree_unlocks")) {
          return { rows: [], rowCount: 0 };
        }
        if (query.startsWith("SELECT is_premium FROM players")) {
          return { rows: [{ is_premium: false }], rowCount: 1 };
        }
        return {
          rows: [{
            total_distance_m: 0,
            cycling_distance_m: 0,
            running_distance_m: 0,
            hiking_distance_m: 0,
            longest_ride_m: 0,
            longest_run_m: 0,
            longest_hike_m: 0,
            total_elevation_gain_m: 0,
            hiking_elevation_gain_m: 0,
            activity_count: "0",
            cycling_activity_count: "0",
            running_activity_count: "0",
            hiking_activity_count: "0",
            distinct_sport_count: "0"
          }],
          rowCount: 1
        };
      }
    } as unknown as PoolClient;

    await readSkillTreeView(client, "player");

    expect(maxConcurrentQueries).toBe(1);
  });
});
