import type { Collectible, CollectibleCategory } from "../domain.js";

export const OSM_SOURCE_TYPE = "osm";
export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";
export const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";

/** Existing categories win over the broader `place` fallback for overlapping objects. */
export const OSM_CATEGORY_ORDER: Exclude<CollectibleCategory, "mountain_pass">[] =
  ["castle", "peak", "waterfall", "viewpoint", "place"];
export const COLLECTIBLE_VALUES: Record<Exclude<CollectibleCategory, "mountain_pass">, number> = {
  viewpoint: 20,
  peak: 50,
  castle: 35,
  waterfall: 35,
  place: 25
};
export const COLLECTIBLE_RADII: Record<Exclude<CollectibleCategory, "mountain_pass">, number> = {
  viewpoint: 100,
  peak: 100,
  castle: 100,
  waterfall: 100,
  place: 100
};

export interface OSMRecord {
  osmType: "node" | "way" | "relation";
  osmId: string;
  latitude: number;
  longitude: number;
  tags: Record<string, string>;
}

export interface OSMCandidate extends OSMRecord {
  id: string;
  name?: string;
  primaryCategory: Exclude<CollectibleCategory, "mountain_pass">;
  categories: Exclude<CollectibleCategory, "mountain_pass">[];
  tagsForCatalog: string[];
  elevationMeters?: number;
  wikidataQid?: string;
  wikipediaReference?: string;
  wikidataLabel?: string;
  wikidataDescription?: string;
  wikidataEntityLabel?: string;
  wikidataCoordinates?: { latitude: number; longitude: number };
  wikidataCompatible?: boolean;
  wikipediaSitelinkMatched: boolean;
  enrichmentMetadata?: Record<string, unknown>;
}

export type Decision = "AUTO_PUBLISH" | "REVIEW" | "IGNORE" | "REJECT";

export interface ScoredCandidate {
  candidate: OSMCandidate;
  score: number;
  reasons: string[];
  decision: Decision;
  rejectionReason?: string;
}

export interface CandidateDuplicate {
  candidateId: string;
  candidateName: string;
  matchedId: string;
  matchedName: string;
  distanceMeters: number;
  identityMatch: "wikidata" | "wikipedia" | "name-distance" | "proximity";
}

export const collectibleFromCandidate = (
  candidate: OSMCandidate,
  extractMetadata: Record<string, unknown>
): Collectible => {
  const name = candidate.name ?? candidate.wikidataLabel;
  if (!name) throw new Error(`Cannot publish unnamed OSM candidate ${candidate.id}.`);
  return {
    id: candidate.id,
    name,
    type: "landmark",
    primaryCategory: candidate.primaryCategory,
    tags: candidate.tagsForCatalog,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    radiusMeters: COLLECTIBLE_RADII[candidate.primaryCategory],
    value: COLLECTIBLE_VALUES[candidate.primaryCategory],
    rarity: "common",
    status: "published",
    ...(candidate.elevationMeters === undefined ? {} : { elevationMeters: candidate.elevationMeters }),
    ...(candidate.wikidataQid === undefined ? {} : { wikidataQid: candidate.wikidataQid }),
    ...(candidate.wikipediaReference === undefined ? {} : { wikipediaReference: candidate.wikipediaReference }),
    source: {
      sourceType: OSM_SOURCE_TYPE,
      sourceExternalId: `${candidate.osmType}:${candidate.osmId}`,
      sourceUrl: `https://www.openstreetmap.org/${candidate.osmType}/${candidate.osmId}`,
      sourceAttribution: OSM_ATTRIBUTION
    },
    enrichmentMetadata: {
      osm: {
        objectType: candidate.osmType,
        objectId: candidate.osmId,
        objectUrl: `https://www.openstreetmap.org/${candidate.osmType}/${candidate.osmId}`,
        copyrightUrl: OSM_COPYRIGHT_URL,
        extract: extractMetadata,
        tags: candidate.tags
      },
      ...(candidate.enrichmentMetadata === undefined ? {} : {
        wikidata: {
          ...candidate.enrichmentMetadata,
          ...(candidate.wikidataEntityLabel ? { entityLabel: candidate.wikidataEntityLabel } : {}),
          ...(candidate.wikidataDescription ? { description: candidate.wikidataDescription } : {}),
          ...(candidate.wikidataCoordinates ? { coordinates: candidate.wikidataCoordinates } : {})
        }
      })
    }
  };
};
