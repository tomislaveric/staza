import { describe, expect, it } from "vitest";
import { collectibleFeature, collectiblesToFeatureCollection } from "./collectible-features.js";
import { filteredWorldCollectibles, mappedWorldCollectibles } from "../world-page.js";

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

describe("collectible source data respects World filters", () => {
  const collectibles = [
    { id: "viewpoint-found", name: "Viewpoint", found: true, primaryCategory: "viewpoint", latitude: 49, longitude: 8 },
    { id: "peak-unfound", name: "Peak", found: false, primaryCategory: "peak", latitude: 50, longitude: 9 },
    { id: "castle-found", name: "Castle", found: true, primaryCategory: "castle", latitude: 51, longitude: 10 }
  ];

  const featureIds = (selectedFilters, questCollectibles) =>
    collectiblesToFeatureCollection(mappedWorldCollectibles(collectibles, selectedFilters, questCollectibles))
      .features.map((feature) => feature.properties.id);

  it("renders exactly the filtered collectibles", () => {
    expect(featureIds([])).toEqual(["viewpoint-found", "peak-unfound", "castle-found"]);
    expect(featureIds(["found"])).toEqual(["viewpoint-found", "castle-found"]);
    expect(featureIds(["unfound"])).toEqual(["peak-unfound"]);
    expect(featureIds(["peak"])).toEqual(["peak-unfound"]);
    expect(featureIds(["castle"])).toEqual(["castle-found"]);
    expect(featureIds(["unfound", "castle", "fartleks"])).toEqual(["peak-unfound", "castle-found"]);
  });

  it("keeps the selected quest collectibles on the map without duplicating them", () => {
    const questCollectible = { id: "quest-only", name: "Quest", found: false, latitude: 52, longitude: 11 };

    expect(featureIds(["found"], [questCollectible, collectibles[0]]))
      .toEqual(["viewpoint-found", "castle-found", "quest-only"]);
  });

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

  it("does not duplicate business filtering outside filteredWorldCollectibles", () => {
    expect(mappedWorldCollectibles(collectibles, ["peak"])).toEqual(filteredWorldCollectibles(collectibles, ["peak"]));
  });
});
