import type { Pool, PoolClient } from "pg";
import type { Fartlek } from "../domain.js";
import type { OpportunityCandidate } from "../flowlineReveal.js";
import type { GeoBounds } from "../worldQuery.js";
import { mapFartlek, SELECT_COLUMNS, type FartlekRow } from "./fartlekRepository.js";

/** Reveals record a player's first ride of a Flowline ("New Flowline discovered"); Explore never writes. */
export type FlowlineRevealSource = "ride";

interface CandidateRow {
  id: string;
  flow_score: number | null;
  suitability_score: number;
  endurance_score: number | null;
  explore_score: number | null;
  road_quality_score: number | null;
  data_confidence: number | null;
}

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

  /** Published Flowlines in the viewport the player has completed: the World map's default Flowlines. */
  async listCompletedWithinBoundsLimited(
    playerId: string,
    bounds: GeoBounds,
    { minLengthMeters = 0, limit }: { minLengthMeters?: number; limit?: number } = {}
  ): Promise<{ fartleks: Fartlek[]; truncated: boolean }> {
    const result = await this.pool.query<FartlekRow>(
      `SELECT ${SELECT_COLUMNS.split(", ").map((column) => `f.${column}`).join(", ")}
       FROM fartleks AS f
       WHERE f.status = 'published' AND f.length_meters >= $6 AND ${BBOX_OVERLAP}
         AND EXISTS (SELECT 1 FROM fartlek_completions AS c WHERE c.player_id = $1 AND c.fartlek_id = f.id)
       ORDER BY f.flow_score DESC, f.length_meters DESC, f.id
       LIMIT $7`,
      [playerId, ...boundsValues(bounds), minLengthMeters, limit === undefined ? null : limit + 1]
    );
    const truncated = limit !== undefined && result.rows.length > limit;
    const rows = (truncated ? result.rows.slice(0, limit) : result.rows).map(mapFartlek);
    return { fartleks: rows.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)), truncated };
  }

  /** Scores of the published Flowlines in the viewport the player has not completed: Explore candidates; never geometry. */
  async listOpportunityCandidatesWithinBounds(playerId: string, bounds: GeoBounds): Promise<OpportunityCandidate[]> {
    const result = await this.pool.query<CandidateRow>(
      `SELECT f.id, f.flow_score, f.suitability_score, f.endurance_score, f.explore_score, f.road_quality_score, f.data_confidence
       FROM fartleks AS f
       WHERE f.status = 'published' AND ${BBOX_OVERLAP}
         AND NOT EXISTS (SELECT 1 FROM fartlek_completions AS c WHERE c.player_id = $1 AND c.fartlek_id = f.id)`,
      [playerId, ...boundsValues(bounds)]
    );
    return result.rows.map((row) => ({
      id: row.id,
      flowScore: row.flow_score ?? row.suitability_score,
      ...(row.endurance_score === null ? {} : { enduranceScore: row.endurance_score }),
      ...(row.explore_score === null ? {} : { exploreScore: row.explore_score }),
      ...(row.road_quality_score === null ? {} : { roadQualityScore: row.road_quality_score }),
      ...(row.data_confidence === null ? {} : { dataConfidence: row.data_confidence })
    }));
  }

  /** Published Flowlines by id, in id order. */
  async listByIds(fartlekIds: string[]): Promise<Fartlek[]> {
    if (fartlekIds.length === 0) return [];
    const result = await this.pool.query<FartlekRow>(
      `SELECT ${SELECT_COLUMNS} FROM fartleks WHERE status = 'published' AND id = ANY($1::text[]) ORDER BY id`,
      [fartlekIds]
    );
    return result.rows.map(mapFartlek);
  }
}
