import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  ActivityType,
  Collectible,
  CollectibleCategory,
  QuestDetail,
  QuestRoute,
  QuestStatus,
  QuestSummary,
  WorldCollectible
} from "../domain.js";
import { deriveQuestCenter, deriveQuestProgress } from "../quest.js";
import { boundsCenter, splitBoundsAtAntimeridian, type GeoBounds } from "../worldQuery.js";

export interface QuestWriteInput {
  title: string;
  description?: string;
  sourceActivityId?: string;
  collectibleIds: string[];
  route?: QuestRoute;
}

export interface QuestPatchInput {
  title?: string;
  description?: string;
  collectibleIds?: string[];
}

interface QuestRow {
  id: string;
  title: string;
  description: string | null;
  status: QuestStatus;
  created_by_player_id: string;
  source_activity_id: string | null;
  center_latitude: number;
  center_longitude: number;
  creator_display_name: string;
}

interface QuestCollectibleRow {
  quest_id: string;
  collectible_id: string;
  order_index: number | null;
  name: string;
  collectible_type: Collectible["type"];
  rarity: Collectible["rarity"] | null;
  latitude: number;
  longitude: number;
  radius_meters: number;
  value: number;
  description: string | null;
  elevation_m: number | null;
  status: Collectible["status"];
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

interface QuestRouteRow {
  quest_id: string;
  source_activity_id: string | null;
  geometry: QuestRoute["geometry"];
  distance_meters: number | null;
  activity_type: ActivityType | null;
}

export class QuestNotFoundError extends Error {
  constructor() {
    super("Quest not found.");
  }
}

const QUEST_COLUMNS = `quests.id, quests.title, quests.description, quests.status,
  quests.created_by_player_id, quests.source_activity_id, quests.center_latitude, quests.center_longitude,
  players.display_name AS creator_display_name`;

const mapCollectible = (row: QuestCollectibleRow): Collectible => ({
  id: row.collectible_id,
  name: row.name,
  type: row.collectible_type,
  latitude: row.latitude,
  longitude: row.longitude,
  radiusMeters: row.radius_meters,
  value: row.value,
  ...(row.rarity === null || row.rarity === undefined ? {} : { rarity: row.rarity }),
  ...(row.description === null ? {} : { description: row.description }),
  ...(row.elevation_m == null ? {} : { elevationMeters: row.elevation_m }),
  ...(row.status == null ? {} : { status: row.status }),
  ...(row.source_type == null || row.source_external_id == null ? {} : {
    source: {
      sourceType: row.source_type,
      sourceExternalId: row.source_external_id,
      ...(row.source_url == null ? {} : { sourceUrl: row.source_url }),
      ...(row.source_attribution == null ? {} : { sourceAttribution: row.source_attribution })
    }
  }),
  ...(row.primary_category == null ? {} : { primaryCategory: row.primary_category }),
  ...(row.tags == null ? {} : { tags: row.tags }),
  ...(row.wikidata_qid == null ? {} : { wikidataQid: row.wikidata_qid }),
  ...(row.wikipedia_reference == null ? {} : { wikipediaReference: row.wikipedia_reference }),
  ...(row.enrichment_metadata == null ? {} : { enrichmentMetadata: row.enrichment_metadata })
});

const mapRoute = (row: QuestRouteRow): QuestRoute => ({
  ...(row.source_activity_id === null ? {} : { sourceActivityId: row.source_activity_id }),
  geometry: row.geometry,
  ...(row.distance_meters === null ? {} : { distanceMeters: row.distance_meters }),
  ...(row.activity_type === null ? {} : { activityType: row.activity_type })
});

const toWorldCollectible = (collectible: Collectible, collectedIds: Set<string>): WorldCollectible => ({
  ...collectible,
  found: collectedIds.has(collectible.id),
  visibility: "visible"
});

export class QuestRepository {
  constructor(private readonly pool: Pool) {}

  async create(playerId: string, input: QuestWriteInput): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const collectibles = await this.loadCollectibles(client, input.collectibleIds);
      const center = deriveQuestCenter(collectibles, input.route);
      const id = randomUUID();
      await client.query(
        `INSERT INTO quests (
          id, title, description, status, created_by_player_id, source_activity_id, center_latitude, center_longitude
        ) VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7)`,
        [
          id,
          input.title,
          input.description ?? null,
          playerId,
          input.sourceActivityId ?? null,
          center.latitude,
          center.longitude
        ]
      );
      await this.replaceCollectibles(client, id, input.collectibleIds);
      if (input.route) {
        await client.query(
          `INSERT INTO quest_routes (quest_id, source_activity_id, geometry, distance_meters, activity_type)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            id,
            input.route.sourceActivityId ?? null,
            JSON.stringify(input.route.geometry),
            input.route.distanceMeters ?? null,
            input.route.activityType ?? null
          ]
        );
      }
      await client.query("COMMIT");
      return id;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async update(playerId: string, questId: string, patch: QuestPatchInput): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const owned = await client.query<{ id: string }>(
        "SELECT id FROM quests WHERE id = $1 AND created_by_player_id = $2 FOR UPDATE",
        [questId, playerId]
      );
      if (owned.rowCount !== 1) throw new QuestNotFoundError();

      if (patch.title !== undefined || patch.description !== undefined) {
        await client.query(
          `UPDATE quests SET
            title = COALESCE($3, title),
            description = CASE WHEN $4::boolean THEN $5 ELSE description END,
            updated_at = now()
          WHERE id = $1 AND created_by_player_id = $2`,
          [questId, playerId, patch.title ?? null, patch.description !== undefined, patch.description ?? null]
        );
      }

      if (patch.collectibleIds !== undefined) {
        await this.replaceCollectibles(client, questId, patch.collectibleIds);
        const collectibles = await this.loadCollectibles(client, patch.collectibleIds);
        const route = await client.query<QuestRouteRow>(
          "SELECT quest_id, source_activity_id, geometry, distance_meters, activity_type FROM quest_routes WHERE quest_id = $1",
          [questId]
        );
        const center = deriveQuestCenter(
          collectibles,
          route.rowCount === 1 ? mapRoute(route.rows[0]) : undefined
        );
        await client.query(
          "UPDATE quests SET center_latitude = $2, center_longitude = $3, updated_at = now() WHERE id = $1",
          [questId, center.latitude, center.longitude]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async setStatus(playerId: string, questId: string, status: QuestStatus): Promise<void> {
    const result = await this.pool.query(
      `UPDATE quests SET
        status = $3,
        published_at = CASE WHEN $3 = 'published' THEN COALESCE(published_at, now()) ELSE NULL END,
        updated_at = now()
      WHERE id = $1 AND created_by_player_id = $2`,
      [questId, playerId, status]
    );
    if (result.rowCount !== 1) throw new QuestNotFoundError();
  }

  async remove(playerId: string, questId: string): Promise<void> {
    const result = await this.pool.query(
      "DELETE FROM quests WHERE id = $1 AND created_by_player_id = $2",
      [questId, playerId]
    );
    if (result.rowCount !== 1) throw new QuestNotFoundError();
  }

  /** Published quests plus the requesting player's own drafts, centred inside the viewport. */
  async listWithinBounds(
    playerId: string,
    bounds: GeoBounds,
    collectedSourceIds: string[],
    limit: number
  ): Promise<QuestSummary[]> {
    const ranges = splitBoundsAtAntimeridian(bounds);
    const center = boundsCenter(bounds);
    const clauses = ranges.map((_range, index) => {
      const base = index * 2;
      return `(quests.center_longitude >= $${base + 4} AND quests.center_longitude <= $${base + 5})`;
    });
    const parameters: unknown[] = [playerId, bounds.minLatitude, bounds.maxLatitude];
    for (const range of ranges) parameters.push(range.minLongitude, range.maxLongitude);
    parameters.push(center.latitude, center.longitude, limit);
    const centerParameter = parameters.length - 2;
    const result = await this.pool.query<QuestRow>(
      `SELECT ${QUEST_COLUMNS}
       FROM quests
       INNER JOIN players ON players.id = quests.created_by_player_id
       WHERE (quests.status = 'published' OR quests.created_by_player_id = $1)
         AND quests.center_latitude >= $2 AND quests.center_latitude <= $3
         AND (${clauses.join(" OR ")})
       ORDER BY (quests.center_latitude - $${centerParameter}) ^ 2 + (quests.center_longitude - $${centerParameter + 1}) ^ 2, quests.id
       LIMIT $${parameters.length}`,
      parameters
    );
    return this.summarize(result.rows, playerId, collectedSourceIds);
  }

  async listByCreator(playerId: string, collectedSourceIds: string[]): Promise<QuestSummary[]> {
    const result = await this.pool.query<QuestRow>(
      `SELECT ${QUEST_COLUMNS}
       FROM quests
       INNER JOIN players ON players.id = quests.created_by_player_id
       WHERE quests.created_by_player_id = $1
       ORDER BY quests.created_at DESC, quests.id`,
      [playerId]
    );
    return this.summarize(result.rows, playerId, collectedSourceIds);
  }

  async get(playerId: string, questId: string, collectedSourceIds: string[]): Promise<QuestDetail> {
    const result = await this.pool.query<QuestRow>(
      `SELECT ${QUEST_COLUMNS}
       FROM quests
       INNER JOIN players ON players.id = quests.created_by_player_id
       WHERE quests.id = $1 AND (quests.status = 'published' OR quests.created_by_player_id = $2)`,
      [questId, playerId]
    );
    if (result.rowCount !== 1) throw new QuestNotFoundError();
    const row = result.rows[0];
    const [collectibleRows, routeResult] = await Promise.all([
      this.pool.query<QuestCollectibleRow>(
        `SELECT quest_collectibles.quest_id, quest_collectibles.collectible_id, quest_collectibles.order_index,
                collectibles.name, collectibles.collectible_type, collectibles.rarity, collectibles.latitude,
                collectibles.longitude, collectibles.radius_meters, collectibles.value, collectibles.description,
                collectibles.elevation_m, collectibles.status, collectibles.source_type, collectibles.source_external_id,
                collectibles.source_url, collectibles.source_attribution, collectibles.primary_category, collectibles.tags,
                collectibles.wikidata_qid, collectibles.wikipedia_reference, collectibles.enrichment_metadata
         FROM quest_collectibles
         INNER JOIN collectibles ON collectibles.id = quest_collectibles.collectible_id
         WHERE quest_collectibles.quest_id = $1
         ORDER BY quest_collectibles.order_index NULLS LAST, collectibles.id`,
        [questId]
      ),
      this.pool.query<QuestRouteRow>(
        "SELECT quest_id, source_activity_id, geometry, distance_meters, activity_type FROM quest_routes WHERE quest_id = $1",
        [questId]
      )
    ]);
    const collected = new Set(collectedSourceIds);
    const collectibles = collectibleRows.rows.map(mapCollectible);
    const route = routeResult.rowCount === 1 ? mapRoute(routeResult.rows[0]) : undefined;
    return {
      id: row.id,
      title: row.title,
      ...(row.description === null ? {} : { description: row.description }),
      status: row.status,
      createdBy: row.creator_display_name,
      isOwner: row.created_by_player_id === playerId,
      centerLatitude: row.center_latitude,
      centerLongitude: row.center_longitude,
      collectibleCount: collectibles.length,
      hasRoute: route !== undefined,
      progress: deriveQuestProgress(collectibles.map((collectible) => collectible.id), collected),
      ...(row.source_activity_id === null ? {} : { sourceActivityId: row.source_activity_id }),
      collectibles: collectibles.map((collectible) => toWorldCollectible(collectible, collected)),
      ...(route === undefined ? {} : { route })
    };
  }

  private async summarize(
    rows: QuestRow[],
    playerId: string,
    collectedSourceIds: string[]
  ): Promise<QuestSummary[]> {
    if (rows.length === 0) return [];
    const questIds = rows.map((row) => row.id);
    const [collectibleRows, routeRows] = await Promise.all([
      this.pool.query<{ quest_id: string; collectible_id: string }>(
        "SELECT quest_id, collectible_id FROM quest_collectibles WHERE quest_id = ANY($1::uuid[])",
        [questIds]
      ),
      this.pool.query<{ quest_id: string }>(
        "SELECT quest_id FROM quest_routes WHERE quest_id = ANY($1::uuid[])",
        [questIds]
      )
    ]);
    const collected = new Set(collectedSourceIds);
    const byQuest = new Map<string, string[]>();
    for (const row of collectibleRows.rows) {
      const existing = byQuest.get(row.quest_id);
      if (existing) existing.push(row.collectible_id);
      else byQuest.set(row.quest_id, [row.collectible_id]);
    }
    const withRoute = new Set(routeRows.rows.map((row) => row.quest_id));
    return rows.map((row) => {
      const ids = byQuest.get(row.id) ?? [];
      return {
        id: row.id,
        title: row.title,
        ...(row.description === null ? {} : { description: row.description }),
        status: row.status,
        createdBy: row.creator_display_name,
        isOwner: row.created_by_player_id === playerId,
        centerLatitude: row.center_latitude,
        centerLongitude: row.center_longitude,
        collectibleCount: ids.length,
        hasRoute: withRoute.has(row.id),
        progress: deriveQuestProgress(ids, collected)
      };
    });
  }

  private async loadCollectibles(client: PoolClient, ids: string[]): Promise<Collectible[]> {
    if (ids.length === 0) return [];
    const result = await client.query<QuestCollectibleRow>(
      `SELECT id AS collectible_id, name, collectible_type, rarity, latitude, longitude,
              radius_meters, value, description, elevation_m, status, source_type, source_external_id,
              source_url, source_attribution, primary_category, tags, wikidata_qid,
              wikipedia_reference, enrichment_metadata, NULL::integer AS order_index, NULL::uuid AS quest_id
       FROM collectibles WHERE id = ANY($1::text[])`,
      [ids]
    );
    return result.rows.map(mapCollectible);
  }

  private async replaceCollectibles(client: PoolClient, questId: string, ids: string[]): Promise<void> {
    await client.query("DELETE FROM quest_collectibles WHERE quest_id = $1", [questId]);
    for (const [index, collectibleId] of ids.entries()) {
      await client.query(
        "INSERT INTO quest_collectibles (quest_id, collectible_id, order_index) VALUES ($1, $2, $3)",
        [questId, collectibleId, index]
      );
    }
  }
}
