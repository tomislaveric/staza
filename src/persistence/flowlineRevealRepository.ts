import type { Pool, PoolClient } from "pg";

/** Reveals record a player's first ride of a Flowline ("New Flowline discovered"). */
export type FlowlineRevealSource = "ride";

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

/** Per-player reveal state of the globally precomputed Flowlines. */
export class FlowlineRevealRepository {
  constructor(private readonly pool: Pick<Pool, "query">) {}

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
}
