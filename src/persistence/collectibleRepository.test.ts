import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { Collectible } from "../domain.js";
import { CollectibleRepository } from "./collectibleRepository.js";

const collectible: Collectible = {
  id: "osm:way:42",
  name: "Sample Castle",
  type: "landmark",
  primaryCategory: "castle",
  tags: ["historic", "viewpoint"],
  latitude: 48,
  longitude: 8,
  radiusMeters: 75,
  value: 35,
  rarity: "common",
  status: "published",
  wikidataQid: "Q123",
  wikipediaReference: "de:Sample_Castle",
  source: {
    sourceType: "osm",
    sourceExternalId: "way:42",
    sourceUrl: "https://www.openstreetmap.org/way/42",
    sourceAttribution: "© OpenStreetMap contributors"
  },
  enrichmentMetadata: { wikidata: { state: "resolved", fetchedAt: "2026-10-01T08:00:00.000Z" } }
};

describe("CollectibleRepository OSM metadata", () => {
  it("maps additive category, tags, identity, and provenance into domain collectibles", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          id: collectible.id,
          name: collectible.name,
          collectible_type: collectible.type,
          rarity: collectible.rarity,
          latitude: collectible.latitude,
          longitude: collectible.longitude,
          radius_meters: collectible.radiusMeters,
          value: collectible.value,
          description: null,
          elevation_m: null,
          status: collectible.status,
          source_type: collectible.source?.sourceType,
          source_external_id: collectible.source?.sourceExternalId,
          source_url: collectible.source?.sourceUrl,
          source_attribution: collectible.source?.sourceAttribution,
          primary_category: collectible.primaryCategory,
          tags: collectible.tags,
          wikidata_qid: collectible.wikidataQid,
          wikipedia_reference: collectible.wikipediaReference,
          enrichment_metadata: collectible.enrichmentMetadata
        }]
      })
    } as unknown as Pool;
    const result = await new CollectibleRepository(pool).listAll();
    expect(result).toEqual([collectible]);
  });

  it("aggregates world stats via SQL counts without loading collectible rows", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ total: 20000, discovered: 12, rare: 3, epic: 1 }]
    });
    const pool = { query } as unknown as Pool;
    const stats = await new CollectibleRepository(pool).worldStats(["a", "a", "b"]);
    expect(stats).toEqual({
      totalCollectibles: 20000,
      discoveredCount: 12,
      rareFinds: 3,
      epicFinds: 1,
      remainingCount: 19988
    });
    const [statement, params] = query.mock.calls[0];
    expect(statement).toContain("FROM collectibles");
    expect(statement).not.toContain("SELECT id, name");
    expect(params).toEqual([["a", "b"]]);
  });

  it("upserts metadata on the canonical collectible row without touching history", async () => {
    const query = vi.fn().mockResolvedValue({});
    const release = vi.fn();
    const pool = {
      connect: vi.fn().mockResolvedValue({ query, release })
    } as unknown as Pool;
    expect(await new CollectibleRepository(pool).upsertMany([collectible])).toBe(1);
    const insert = query.mock.calls.find(([statement]) =>
      typeof statement === "string" && statement.includes("INSERT INTO collectibles"));
    expect(insert?.[1]).toEqual(expect.arrayContaining([
      "castle",
      ["historic", "viewpoint"],
      "Q123",
      "de:Sample_Castle",
      JSON.stringify(collectible.enrichmentMetadata)
    ]));
    expect(query.mock.calls.map(([statement]) => statement)).toEqual([
      "BEGIN",
      expect.stringContaining("INSERT INTO collectibles"),
      "COMMIT"
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("persists Mountain Pass type as its collectible category", async () => {
    const query = vi.fn().mockResolvedValue({});
    const pool = {
      connect: vi.fn().mockResolvedValue({ query, release: vi.fn() })
    } as unknown as Pool;
    const { primaryCategory: _category, ...landmark } = collectible;
    await new CollectibleRepository(pool).upsertMany([{
      ...landmark,
      id: "quaeldich:pass",
      name: "Mountain Pass",
      type: "mountain_pass"
    }]);
    const insert = query.mock.calls.find(([statement]) =>
      typeof statement === "string" && statement.includes("INSERT INTO collectibles"));
    expect(insert?.[1]?.[15]).toBe("mountain_pass");
  });
});
