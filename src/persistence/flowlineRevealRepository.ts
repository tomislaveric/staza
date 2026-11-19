import type { Pool, PoolClient } from "pg";
import type { Fartlek } from "../domain.js";
import type { GeoBounds } from "../worldQuery.js";
import { mapFartlek, SELECT_COLUMNS, type FartlekRow } from "./fartlekRepository.js";

export type FlowlineRevealSource = "explore" | "ride";

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

const BBOX_OVERLAP = `box(point(f.bbox_min_longitude, f.bbox_min_latitude), point(f.bbox_max_longitude, f.bbox_max_latitude))
  && box(point($2, $4), point($3, $5))`;

const boundsValues = (bounds: GeoBounds) => [bounds.minLongitude, bounds.maxLongitude, bounds.minLatitude, bounds.maxLatitude];

/** Per-player reveal state of the globally precomputed Flowlines. */
export class FlowlineRevealRepository {
  constructor(private readonly pool: Pool) {}

  async revealedIds(playerId: string, fartlekIds: string[], client: Queryable = this.pool): Promise<Set<string>> {
    if (fartlekIds.length === 0) return new Set();
    const result = await client.query<{ fartlek_id: string }>(
      "SELECT fartlek_id FROM player_flowline_reveals WHERE player_id = $1 AND fartlek_id = ANY($2::text[])",
      [playerId, fartlekIds]
    );
    return new Set(result.rows.map((row) => row.fartlek_id));
  }

  /** Reveals idempotently; returns only the ids that were hidden before. */
  async reveal(playerId: string, fartlekIds: string[], source: FlowlineRevealSource, client: Queryable = this.pool): Promise<string[]> {
    if (fartlekIds.length === 0) return [];
    const result = await client.query<{ fartlek_id: string }>(
      `INSERT INTO player_flowline_reveals (player_id, fartlek_id, source)
       SELECT $1, id, $3 FROM fartleks WHERE id = ANY($2::text[])
       ON CONFLICT DO NOTHING
       RETURNING fartlek_id`,
      [playerId, [...new Set(fartlekIds)], source]
    );
    return result.rows.map((row) => row.fartlek_id).sort();
  }

  /** Revealed published Flowlines in the viewport, best-scored first when capped (as the public World query). */
  async listRevealedWithinBoundsLimited(
    playerId: string,
    bounds: GeoBounds,
    { minLengthMeters = 0, limit }: { minLengthMeters?: number; limit?: number } = {}
  ): Promise<{ fartleks: Fartlek[]; truncated: boolean }> {
    const result = await this.pool.query<FartlekRow>(
      `SELECT ${SELECT_COLUMNS.split(", ").map((column) => `f.${column}`).join(", ")}
       FROM fartleks AS f
       INNER JOIN player_flowline_reveals AS r ON r.fartlek_id = f.id AND r.player_id = $1
       WHERE f.status = 'published' AND f.length_meters >= $6 AND ${BBOX_OVERLAP}
       ORDER BY f.flow_score DESC, f.length_meters DESC, f.id
       LIMIT $7`,
      [playerId, ...boundsValues(bounds), minLengthMeters, limit === undefined ? null : limit + 1]
    );
    const truncated = limit !== undefined && result.rows.length > limit;
    const rows = (truncated ? result.rows.slice(0, limit) : result.rows).map(mapFartlek);
    return { fartleks: rows.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)), truncated };
  }

  /** Published Flowlines in the viewport the player has not revealed yet. */
  async countHiddenWithinBounds(playerId: string, bounds: GeoBounds): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM fartleks AS f
       WHERE f.status = 'published' AND ${BBOX_OVERLAP}
         AND NOT EXISTS (SELECT 1 FROM player_flowline_reveals AS r WHERE r.player_id = $1 AND r.fartlek_id = f.id)`,
      [playerId, ...boundsValues(bounds)]
    );
    return Number(result.rows[0]?.count ?? 0);
  }
}
