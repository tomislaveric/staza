import { describe, expect, it } from "vitest";
import { collectibleFeature, collectiblesToFeatureCollection } from "./collectible-features.js";

const collectible = (overrides = {}) => ({
  id: "viewpoint-1",
  name: "Turmberg",
  type: "landmark",
  found: false,
  latitude: 49.0069,
  longitude: 8.4037,
  ...overrides
});

describe("collectible GeoJSON conversion", () => {
  it("converts each collectible into a point feature", () => {
    const featureCollection = collectiblesToFeatureCollection([collectible(), collectible({ id: "coin-1" })]);

    expect(featureCollection.type).toBe("FeatureCollection");
    expect(featureCollection.features).toHaveLength(2);
    expect(featureCollection.features[0].type).toBe("Feature");
    expect(featureCollection.features[0].geometry.type).toBe("Point");
  });

  it("keeps geographic coordinates in longitude, latitude order", () => {
    const feature = collectibleFeature(collectible({ longitude: 8.4037, latitude: 49.0069 }));

    expect(feature.geometry.coordinates).toEqual([8.4037, 49.0069]);
  });

  it("preserves the collectible id on the feature and its properties", () => {
    const feature = collectibleFeature(collectible({ id: "castle-7" }));

    expect(feature.id).toBe("castle-7");
    expect(feature.properties.id).toBe("castle-7");
  });

  it("preserves visited state for found and unfound collectibles", () => {
    expect(collectibleFeature(collectible({ found: true })).properties.visited).toBe(true);
    expect(collectibleFeature(collectible({ found: false })).properties.visited).toBe(false);
  });

  it("does not add obsolete metadata to map features", () => {
    expect(collectibleFeature(collectible()).properties).not.toHaveProperty("rarity");
  });

  it("carries category and name so future icons need no data model change", () => {
    const feature = collectibleFeature(collectible({ type: "landmark", name: "Turmberg" }));

    expect(feature.properties.category).toBe("landmark");
    expect(feature.properties.name).toBe("Turmberg");
  });

  it("carries OSM category, tags, and provenance without changing the gameplay type", () => {
    const feature = collectibleFeature(collectible({
      primaryCategory: "castle",
      tags: ["historic", "viewpoint"],
      wikidataQid: "Q123",
      wikipediaReference: "de:Sample_Castle",
      source: {
        sourceType: "osm",
        sourceExternalId: "way:42",
        sourceUrl: "https://www.openstreetmap.org/way/42",
        sourceAttribution: "© OpenStreetMap contributors"
      }
    }));
    expect(feature.properties).toMatchObject({
      category: "castle",
      tags: ["historic", "viewpoint"],
      sourceType: "osm",
      sourceExternalId: "way:42",
      wikidataQid: "Q123",
      wikipediaReference: "de:Sample_Castle",
      visited: false
    });
  });

  it("marks only the selected collectible as selected", () => {
    const featureCollection = collectiblesToFeatureCollection(
      [collectible({ id: "a" }), collectible({ id: "b" })],
      { selectedId: "b" }
    );

    expect(featureCollection.features.map((feature) => feature.properties.selected)).toEqual([false, true]);
  });

  it("marks each selected quest collectible for map emphasis", () => {
    const featureCollection = collectiblesToFeatureCollection(
      [collectible({ id: "a" }), collectible({ id: "b" })],
      { questCollectibleIds: ["b"] }
    );

    expect(featureCollection.features.map((feature) => feature.properties.questTarget)).toEqual([false, true]);
    expect(featureCollection.features.map((feature) => feature.properties.questRelated)).toEqual([false, true]);
  });
});

describe("collectible route emphasis", () => {
  it("marks quest collectibles as quest related while a quest is active", () => {
    const featureCollection = collectiblesToFeatureCollection(
      [collectible({ id: "in-quest" }), collectible({ id: "elsewhere" })],
      { questCollectibleIds: ["in-quest"] }
    );

    const related = Object.fromEntries(
      featureCollection.features.map((feature) => [feature.properties.id, feature.properties.questRelated])
    );
    expect(related).toEqual({ "in-quest": true, elsewhere: false });
  });

  it("treats every collectible as quest related when no quest is selected", () => {
    const featureCollection = collectiblesToFeatureCollection([collectible(), collectible({ id: "coin-1" })]);

    expect(featureCollection.features.every((feature) => feature.properties.questRelated)).toBe(true);
  });
});
