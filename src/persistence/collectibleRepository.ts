import type { Pool } from "pg";
import type { Collectible, CollectibleCategory, CollectibleRarity, CollectibleStatus, CollectibleType, WorldStats } from "../domain.js";
import type { GeoBounds } from "../worldQuery.js";
import { boundsCenter, splitBoundsAtAntimeridian } from "../worldQuery.js";

interface CollectibleRow {
  id: string;
  name: string;
  collectible_type: CollectibleType;
  rarity: CollectibleRarity | null;
  latitude: number;
  longitude: number;
  radius_meters: number;
  value: number;
  description: string | null;
  elevation_m: number | null;
  status: CollectibleStatus;
  source_type: string | null;
  source_external_id: string | null;
  source_url: string | null;
  source_attribution: string | null;
  primary_category: CollectibleCategory | null;
  tags: string[];
  wikidata_qid: string | null;
  wikipedia_reference: string | null;
  enrichment_metadata: Record<string, unknown> | null;
}

const mapCollectible = (row: CollectibleRow): Collectible => ({
  id: row.id,
  name: row.name,
  type: row.collectible_type,
  latitude: row.latitude,
  longitude: row.longitude,
  radiusMeters: row.radius_meters,
  value: row.value,
  status: row.status,
  ...(row.rarity === null ? {} : { rarity: row.rarity }),
  ...(row.description === null ? {} : { description: row.description }),
  ...(row.elevation_m === null ? {} : { elevationMeters: row.elevation_m }),
  ...(row.source_type === null || row.source_external_id === null
    ? {}
    : {
        source: {
          sourceType: row.source_type,
          sourceExternalId: row.source_external_id,
          ...(row.source_url === null ? {} : { sourceUrl: row.source_url }),
          ...(row.source_attribution === null ? {} : { sourceAttribution: row.source_attribution })
        }
      }),
  ...(row.primary_category === null ? {} : { primaryCategory: row.primary_category }),
  tags: row.tags,
  ...(row.wikidata_qid === null ? {} : { wikidataQid: row.wikidata_qid }),
  ...(row.wikipedia_reference === null ? {} : { wikipediaReference: row.wikipedia_reference }),
  ...(row.enrichment_metadata === null ? {} : { enrichmentMetadata: row.enrichment_metadata })
});

const SELECT_COLUMNS =
  "id, name, collectible_type, rarity, latitude, longitude, radius_meters, value, description, " +
  "elevation_m, status, source_type, source_external_id, source_url, source_attribution, " +
  "primary_category, tags, wikidata_qid, wikipedia_reference, enrichment_metadata";

export class CollectibleRepository {
  constructor(private readonly pool: Pool) {}

  async listAll(): Promise<Collectible[]> {
    const result = await this.pool.query<CollectibleRow>(
      `SELECT ${SELECT_COLUMNS} FROM collectibles ORDER BY id`
    );
    return result.rows.map(mapCollectible);
  }

  /**
   * Aggregates world discovery statistics with SQL counts so the global (no-bbox) snapshot never
   * has to load every collectible row. Discovery stats mirror createWorldSnapshot: only source IDs
   * present in the catalog count as discovered.
   */
  async worldStats(discoveredSourceIds: Iterable<string>): Promise<WorldStats> {
    const ids = [...new Set(discoveredSourceIds)];
    const result = await this.pool.query<{ total: number; discovered: number; rare: number; epic: number }>(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE id = ANY($1::text[]))::int AS discovered,
         COUNT(*) FILTER (WHERE id = ANY($1::text[]) AND rarity = 'rare')::int AS rare,
         COUNT(*) FILTER (WHERE id = ANY($1::text[]) AND rarity = 'epic')::int AS epic
       FROM collectibles`,
      [ids]
    );
    const { total, discovered, rare, epic } = result.rows[0];
    return {
      totalCollectibles: total,
      discoveredCount: discovered,
      rareFinds: rare,
      epicFinds: epic,
      remainingCount: total - discovered
    };
  }

  async listWithinBounds(bounds: GeoBounds, limit: number): Promise<{ collectibles: Collectible[]; truncated: boolean }> {
    const ranges = splitBoundsAtAntimeridian(bounds);
    const center = boundsCenter(bounds);
    const clauses = ranges.map((_range, index) => {
      const base = index * 2;
      return `(longitude >= $${base + 3} AND longitude <= $${base + 4})`;
    });
    const parameters: unknown[] = [bounds.minLatitude, bounds.maxLatitude];
    for (const range of ranges) parameters.push(range.minLongitude, range.maxLongitude);
    parameters.push(center.latitude, center.longitude, limit + 1);
    const centerLatitudeParameter = parameters.length - 2;
    const result = await this.pool.query<CollectibleRow>(
      `SELECT ${SELECT_COLUMNS} FROM collectibles
       WHERE latitude >= $1 AND latitude <= $2 AND (${clauses.join(" OR ")})
       ORDER BY (latitude - $${centerLatitudeParameter}) ^ 2 + (longitude - $${centerLatitudeParameter + 1}) ^ 2, id
       LIMIT $${parameters.length}`,
      parameters
    );
    const truncated = result.rows.length > limit;
    return { collectibles: result.rows.slice(0, limit).map(mapCollectible), truncated };
  }

  async listByIds(ids: string[]): Promise<Collectible[]> {
    if (ids.length === 0) return [];
    const result = await this.pool.query<CollectibleRow>(
      `SELECT ${SELECT_COLUMNS} FROM collectibles WHERE id = ANY($1::text[]) ORDER BY id`,
      [ids]
    );
    return result.rows.map(mapCollectible);
  }

  async listBySourceType(sourceType: string): Promise<Collectible[]> {
    const result = await this.pool.query<CollectibleRow>(
      `SELECT ${SELECT_COLUMNS} FROM collectibles WHERE source_type = $1 ORDER BY id`,
      [sourceType]
    );
    return result.rows.map(mapCollectible);
  }

  async upsertMany(collectibles: Collectible[]): Promise<number> {
    if (collectibles.length === 0) return 0;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const collectible of collectibles) {
        await client.query(
          `INSERT INTO collectibles (
            id, name, collectible_type, rarity, latitude, longitude, radius_meters, value, description,
            elevation_m, status, source_type, source_external_id, source_url, source_attribution,
            primary_category, tags, wikidata_qid, wikipedia_reference, enrichment_metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                    $16, $17, $18, $19, $20)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            collectible_type = EXCLUDED.collectible_type,
            rarity = EXCLUDED.rarity,
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            radius_meters = EXCLUDED.radius_meters,
            value = EXCLUDED.value,
            description = EXCLUDED.description,
            elevation_m = EXCLUDED.elevation_m,
            status = EXCLUDED.status,
            source_type = EXCLUDED.source_type,
            source_external_id = EXCLUDED.source_external_id,
            source_url = EXCLUDED.source_url,
            source_attribution = EXCLUDED.source_attribution,
            primary_category = EXCLUDED.primary_category,
            tags = EXCLUDED.tags,
            wikidata_qid = EXCLUDED.wikidata_qid,
            wikipedia_reference = EXCLUDED.wikipedia_reference,
            enrichment_metadata = EXCLUDED.enrichment_metadata,
            updated_at = now()`,
          [
            collectible.id,
            collectible.name,
            collectible.type,
            collectible.rarity ?? null,
            collectible.latitude,
            collectible.longitude,
            collectible.radiusMeters,
            collectible.value,
            collectible.description ?? null,
            collectible.elevationMeters ?? null,
            collectible.status ?? "published",
            collectible.source?.sourceType ?? null,
            collectible.source?.sourceExternalId ?? null,
            collectible.source?.sourceUrl ?? null,
            collectible.source?.sourceAttribution ?? null,
            collectible.primaryCategory ?? null,
            collectible.tags ?? [],
            collectible.wikidataQid ?? null,
            collectible.wikipediaReference ?? null,
            collectible.enrichmentMetadata ? JSON.stringify(collectible.enrichmentMetadata) : null
          ]
        );
      }
      await client.query("COMMIT");
      return collectibles.length;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
