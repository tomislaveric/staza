import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabasePool } from "./database.js";
import { FlowlineRevealRepository } from "./flowlineRevealRepository.js";
import { migrate } from "./migrate.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describePersistence = databaseUrl ? describe : describe.skip;
const playerId = "00000000-0000-4000-8000-000000000098";
const otherPlayerId = "00000000-0000-4000-8000-000000000097";
const pool = databaseUrl ? createDatabasePool(databaseUrl) : undefined;
const repository = pool ? new FlowlineRevealRepository(pool) : undefined;
const bounds = { minLatitude: 55, maxLatitude: 56, minLongitude: 12, maxLongitude: 13 };

const insertFlowline = (id: string, longitude: number, flowScore: number) => pool!.query(
  `INSERT INTO fartleks (
     id, name, geometry, start_latitude, start_longitude, end_latitude, end_longitude,
     bbox_min_latitude, bbox_min_longitude, bbox_max_latitude, bbox_max_longitude, length_meters,
     status, source_type, source_external_id, suitability_score, mapping_confidence, flow_score
   ) VALUES ($1, $1, $2, 55.5, $3, 55.51, $4, 55.5, $3, 55.51, $4, 1500, 'published', 'osm', $1, 90, 95, $5)`,
  [id, JSON.stringify({ type: "LineString", coordinates: [[longitude, 55.5], [longitude + 0.01, 55.51]] }), longitude, longitude + 0.01, flowScore]
);

describePersistence("FlowlineRevealRepository", () => {
  beforeEach(async () => {
    await migrate(pool!);
    await pool!.query("TRUNCATE players, fartleks CASCADE");
    await pool!.query(
      "INSERT INTO players (id, display_name, created_at) VALUES ($1, 'Reveal test', '2020-01-01'), ($2, 'Other', '2020-01-01')",
      [playerId, otherPlayerId]
    );
    await insertFlowline("flow-a", 12.5, 80);
    await insertFlowline("flow-b", 12.6, 60);
    await insertFlowline("flow-outside", 20, 99);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("records ride reveals per player, idempotently, and only for existing Flowlines", async () => {
    expect(await repository!.reveal(playerId, ["flow-b", "flow-a", "flow-a", "missing"], "ride")).toEqual(["flow-a", "flow-b"]);
    expect(await repository!.reveal(playerId, ["flow-a"], "ride")).toEqual([]);
    expect(await repository!.revealedIds(playerId, ["flow-a", "flow-outside"])).toEqual(new Set(["flow-a"]));
    expect(await repository!.revealedIds(otherPlayerId, ["flow-a"])).toEqual(new Set());
    await expect(pool!.query(
      "INSERT INTO player_flowline_reveals (player_id, fartlek_id, source) VALUES ($1, 'flow-outside', 'explore')",
      [playerId]
    )).rejects.toThrow();
  });

  it("lists opportunity candidates the player has not completed, without geometry", async () => {
    expect((await repository!.listOpportunityCandidatesWithinBounds(playerId, bounds)).map((row) => row.id).sort()).toEqual(["flow-a", "flow-b"]);
    await pool!.query(
      "INSERT INTO activities (id, player_id, source_type, started_at, xp_earned, collected_count) VALUES ('ride-0', $1, 'fit', now(), 0, 0)",
      [playerId]
    );
    await pool!.query(
      `INSERT INTO fartlek_completions (id, fartlek_id, player_id, activity_id, completed_at, elapsed_time_s, average_speed_mps,
         fartlek_length_m_snapshot, fartlek_geometry_version_snapshot)
       VALUES ('00000000-0000-4000-8000-0000000000c0', 'flow-b', $1, 'ride-0', now(), 300, 5, 1500, 1)`,
      [playerId]
    );
    expect(await repository!.listOpportunityCandidatesWithinBounds(playerId, bounds)).toEqual([{ id: "flow-a", flowScore: 80 }]);
    expect(await repository!.listOpportunityCandidatesWithinBounds(otherPlayerId, bounds)).toHaveLength(2);
    expect((await repository!.listByIds(["flow-b", "missing"])).map((row) => row.id)).toEqual(["flow-b"]);
  });

  it("lists only the player's completed Flowlines for the default map", async () => {
    await pool!.query(
      "INSERT INTO activities (id, player_id, source_type, started_at, xp_earned, collected_count) VALUES ('ride-1', $1, 'fit', now(), 0, 0)",
      [playerId]
    );
    await pool!.query(
      `INSERT INTO fartlek_completions (id, fartlek_id, player_id, activity_id, completed_at, elapsed_time_s, average_speed_mps,
         fartlek_length_m_snapshot, fartlek_geometry_version_snapshot)
       VALUES ('00000000-0000-4000-8000-0000000000c1', 'flow-a', $1, 'ride-1', now(), 300, 5, 1500, 1)`,
      [playerId]
    );
    await repository!.reveal(playerId, ["flow-b"], "ride");
    expect(await repository!.listCompletedWithinBoundsLimited(playerId, bounds)).toMatchObject({ truncated: false, fartleks: [{ id: "flow-a" }] });
    expect((await repository!.listCompletedWithinBoundsLimited(otherPlayerId, bounds)).fartleks).toEqual([]);
  });
});
