import { canonicalRarity } from "../../collected-list.js";

export const DEFAULT_COLLECTIBLE_CATEGORY = "coin";
export const DEFAULT_COLLECTIBLE_RARITY = "common";

export const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };

export const collectibleCategory = (collectible) =>
  collectible.primaryCategory ?? collectible.type ?? DEFAULT_COLLECTIBLE_CATEGORY;

/**
 * Converts a Staza collectible into a canonical GeoJSON point feature. Coordinates stay
 * geographic so MapLibre owns every projection; Staza state travels as properties only.
 *
 * `activityPending` and `activityCollected` are presentation-only flags used by Activity
 * Detail to render a historical collection transition. They never change domain state and
 * default to falsey, so World features are unchanged.
 */
export const collectibleFeature = (collectible, selectedId, questCollectibleIds) => ({
  type: "Feature",
  id: collectible.id,
  geometry: {
    type: "Point",
    coordinates: [collectible.longitude, collectible.latitude]
  },
  properties: {
    id: collectible.id,
    name: collectible.name ?? collectible.id,
    category: collectibleCategory(collectible),
    tags: collectible.tags ?? [],
    sourceType: collectible.source?.sourceType ?? null,
    sourceExternalId: collectible.source?.sourceExternalId ?? null,
    sourceUrl: collectible.source?.sourceUrl ?? null,
    sourceAttribution: collectible.source?.sourceAttribution ?? null,
    wikidataQid: collectible.wikidataQid ?? null,
    wikipediaReference: collectible.wikipediaReference ?? null,
    rarity: canonicalRarity(collectible.rarity) ?? DEFAULT_COLLECTIBLE_RARITY,
    visited: Boolean(collectible.found),
    selected: collectible.id === selectedId,
    questTarget: Boolean(questCollectibleIds?.has(collectible.id)),
    questRelated: !questCollectibleIds || questCollectibleIds.has(collectible.id),
    activityPending: Boolean(collectible.activityPending),
    activityCollected: Boolean(collectible.activityCollected)
  }
});

/**
 * @param {object} [options]
 * @param {string} [options.selectedId]
 * @param {Iterable<string>} [options.questCollectibleIds] Ids of the selected quest's
 *   collectibles. Presentational only: selected targets are highlighted and unrelated
 *   features are dimmed; when omitted the default marker hierarchy is unchanged.
 */
export const collectiblesToFeatureCollection = (collectibles, { selectedId, questCollectibleIds } = {}) => {
  const questIds = questCollectibleIds ? new Set(questCollectibleIds) : undefined;
  return {
    type: "FeatureCollection",
    features: collectibles.map((collectible) => collectibleFeature(collectible, selectedId, questIds))
  };
};
