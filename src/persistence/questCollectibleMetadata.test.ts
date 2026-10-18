import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { QuestRepository } from "./questRepository.js";

describe("QuestRepository semantic collectible mapping", () => {
  it("retains OSM category, tags, and provenance in quest-loaded World collectibles", async () => {
    const query = vi.fn(async (statement: string) => {
      if (statement.includes("SELECT quests.id")) {
        return {
          rows: [{
            id: "quest-1",
            title: "Castle walk",
            description: null,
            status: "published",
            created_by_player_id: "player-1",
            source_activity_id: null,
            center_latitude: 48,
            center_longitude: 8,
            creator_display_name: "Curator"
          }],
          rowCount: 1
        };
      }
      if (statement.includes("FROM quest_collectibles")) {
        return {
          rows: [{
            quest_id: "quest-1",
            collectible_id: "osm:way:42",
            order_index: 0,
            name: "Sample Castle",
            collectible_type: "landmark",
            latitude: 48,
            longitude: 8,
            radius_meters: 75,
            value: 35,
            description: null,
            elevation_m: null,
            status: "published",
            source_type: "osm",
            source_external_id: "way:42",
            source_url: "https://www.openstreetmap.org/way/42",
            source_attribution: "© OpenStreetMap contributors",
            primary_category: "castle",
            tags: ["historic"],
            wikidata_qid: "Q123",
            wikipedia_reference: "de:Sample_Castle",
            enrichment_metadata: { wikidata: { state: "resolved" } }
          }]
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const repository = new QuestRepository({ query } as unknown as Pool);

    const result = await repository.get("player-1", "quest-1", []);
    expect(result.collectibles[0]).toMatchObject({
      id: "osm:way:42",
      primaryCategory: "castle",
      tags: ["historic"],
      wikidataQid: "Q123",
      wikipediaReference: "de:Sample_Castle",
      source: {
        sourceType: "osm",
        sourceExternalId: "way:42",
        sourceUrl: "https://www.openstreetmap.org/way/42"
      },
      enrichmentMetadata: { wikidata: { state: "resolved" } },
      found: false
    });
  });
});
