import type { Pool } from "pg";
import type { Fartlek, FartlekGeometry, FartlekStatus } from "../domain.js";
import type { GeoBounds } from "../worldQuery.js";
import { fartlekGeometryBounds } from "../fartlek.js";

interface FartlekRow {
  id: string;
  name: string;
  geometry: FartlekGeometry;
  start_latitude: number;
  start_longitude: number;
  end_latitude: number;
  end_longitude: number;
  length_meters: number;
  status: FartlekStatus;
  direction_restricted: boolean | null;
  source_type: string;
  source_external_id: string;
  source_attribution: string | null;
  source_metadata: Record<string, unknown> | null;
  suitability_score: number;
  suitability_reasons: string[];
  mapping_confidence: number;
  geometry_version: number;
  created_at: Date;
  updated_at: Date;
}

const mapFartlek = (row: FartlekRow): Fartlek => ({
  id: row.id,
  name: row.name,
  geometry: row.geometry,
  startLatitude: row.start_latitude,
  startLongitude: row.start_longitude,
  endLatitude: row.end_latitude,
  endLongitude: row.end_longitude,
  lengthMeters: row.length_meters,
  status: row.status,
  ...(row.direction_restricted === null ? {} : { directionRestricted: row.direction_restricted }),
  source: {
    sourceType: row.source_type,
    sourceExternalId: row.source_external_id,
    ...(row.source_attribution === null ? {} : { sourceAttribution: row.source_attribution })
  },
  ...(row.source_metadata === null ? {} : { sourceMetadata: row.source_metadata }),
  suitabilityScore: row.suitability_score,
  suitabilityReasons: row.suitability_reasons,
  mappingConfidence: row.mapping_confidence,
  geometryVersion: row.geometry_version,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString()
});

const SELECT_COLUMNS =
  "id, name, geometry, start_latitude, start_longitude, end_latitude, end_longitude, length_meters, status, " +
  "direction_restricted, source_type, source_external_id, source_attribution, source_metadata, " +
  "suitability_score, suitability_reasons, mapping_confidence, geometry_version, created_at, updated_at";

export class FartlekRepository {
  constructor(private readonly pool: Pool) {}

  async listAll(): Promise<Fartlek[]> {
    const result = await this.pool.query<FartlekRow>(`SELECT ${SELECT_COLUMNS} FROM fartleks ORDER BY id`);
    return result.rows.map(mapFartlek);
  }

  async listPublished(): Promise<Fartlek[]> {
    const result = await this.pool.query<FartlekRow>(
      `SELECT ${SELECT_COLUMNS} FROM fartleks WHERE status = 'published' ORDER BY id`
    );
    return result.rows.map(mapFartlek);
  }

  async listByIds(ids: string[]): Promise<Fartlek[]> {
    if (ids.length === 0) return [];
    const result = await this.pool.query<FartlekRow>(
      `SELECT ${SELECT_COLUMNS} FROM fartleks WHERE id = ANY($1::text[]) ORDER BY id`,
      [ids]
    );
    return result.rows.map(mapFartlek);
  }

  /**
   * Fartleks are filtered to the viewport in SQL using a precomputed geometry bounding box and a
   * GiST index, so a world load only deserializes the handful of geometries that overlap the bbox
   * rather than the entire published catalog.
   */
  async listWithinBounds(bounds: GeoBounds): Promise<Fartlek[]> {
    const result = await this.pool.query<FartlekRow>(
      `SELECT ${SELECT_COLUMNS} FROM fartleks
       WHERE status = 'published'
         AND box(
               point(bbox_min_longitude, bbox_min_latitude),
               point(bbox_max_longitude, bbox_max_latitude)
             ) && box(point($1, $3), point($2, $4))
       ORDER BY id`,
      [bounds.minLongitude, bounds.maxLongitude, bounds.minLatitude, bounds.maxLatitude]
    );
    return result.rows.map(mapFartlek);
  }

  async upsertMany(fartleks: Fartlek[]): Promise<number> {
    if (fartleks.length === 0) return 0;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const fartlek of fartleks) {
        const geometryBounds = fartlekGeometryBounds(fartlek.geometry);
        await client.query(
          `INSERT INTO fartleks (
            id, name, geometry, start_latitude, start_longitude, end_latitude, end_longitude, length_meters,
            status, direction_restricted, source_type, source_external_id, source_attribution, source_metadata,
            suitability_score, suitability_reasons, mapping_confidence, geometry_version,
            bbox_min_latitude, bbox_max_latitude, bbox_min_longitude, bbox_max_longitude
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            geometry = EXCLUDED.geometry,
            start_latitude = EXCLUDED.start_latitude,
            start_longitude = EXCLUDED.start_longitude,
            end_latitude = EXCLUDED.end_latitude,
            end_longitude = EXCLUDED.end_longitude,
            length_meters = EXCLUDED.length_meters,
            status = EXCLUDED.status,
            direction_restricted = EXCLUDED.direction_restricted,
            source_type = EXCLUDED.source_type,
            source_external_id = EXCLUDED.source_external_id,
            source_attribution = EXCLUDED.source_attribution,
            source_metadata = EXCLUDED.source_metadata,
            suitability_score = EXCLUDED.suitability_score,
            suitability_reasons = EXCLUDED.suitability_reasons,
            mapping_confidence = EXCLUDED.mapping_confidence,
            bbox_min_latitude = EXCLUDED.bbox_min_latitude,
            bbox_max_latitude = EXCLUDED.bbox_max_latitude,
            bbox_min_longitude = EXCLUDED.bbox_min_longitude,
            bbox_max_longitude = EXCLUDED.bbox_max_longitude,
            geometry_version = fartleks.geometry_version + 1,
            updated_at = now()`,
          [
            fartlek.id,
            fartlek.name,
            JSON.stringify(fartlek.geometry),
            fartlek.startLatitude,
            fartlek.startLongitude,
            fartlek.endLatitude,
            fartlek.endLongitude,
            fartlek.lengthMeters,
            fartlek.status,
            fartlek.directionRestricted ?? null,
            fartlek.source.sourceType,
            fartlek.source.sourceExternalId,
            fartlek.source.sourceAttribution ?? null,
            fartlek.sourceMetadata ? JSON.stringify(fartlek.sourceMetadata) : null,
            fartlek.suitabilityScore,
            fartlek.suitabilityReasons,
            fartlek.mappingConfidence,
            fartlek.geometryVersion,
            geometryBounds.minLatitude,
            geometryBounds.maxLatitude,
            geometryBounds.minLongitude,
            geometryBounds.maxLongitude
          ]
        );
      }
      await client.query("COMMIT");
      return fartleks.length;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
