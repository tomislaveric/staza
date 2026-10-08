export const FARTLEK_SOURCE_TYPE = "osm";
export const FARTLEK_CANDIDATE_GENERATION_VERSION = "fartlek-candidates-v2";
export const FARTLEK_SCORING_VERSION = "fartlek-score-v1";

export const FARTLEK_MIN_LENGTH_METERS = 1_000;
export const FARTLEK_IDEAL_MIN_LENGTH_METERS = 2_000;
export const FARTLEK_IDEAL_MAX_LENGTH_METERS = 8_000;
export const FARTLEK_MAX_LENGTH_METERS = 15_000;

/**
 * A single OSM `highway` way, preserving its full coordinate array — unlike `OSMRecord`, which
 * only stores a centroid. Also used to capture `traffic_sign=city_limit` boundary nodes, which
 * carry no coordinate array (a single-point way of length 1).
 */
export interface OSMWayRecord {
  osmType: "way" | "node";
  osmId: string;
  /** [longitude, latitude] pairs, in way order. */
  coordinates: [number, number][];
  tags: Record<string, string>;
}

/** One candidate Fartlek segment generated between two logical boundaries on continuous road geometry. */
export interface FartlekCandidate {
  id: string;
  name?: string;
  coordinates: [number, number][];
  lengthMeters: number;
  sourceWayIds: string[];
  candidateGenerationVersion: string;
  /** Count of OSM junction nodes along the candidate (road-to-road intersections). */
  junctionCount: number;
  /** Count of stop signs / traffic signals / traffic calming features along the candidate. */
  trafficControlCount: number;
  /** Tags for each contributing way, in order, used to compute mapping completeness. */
  tagsBySegment: Record<string, string>[];
  /** True when both ends are evidenced by explicit boundaries (e.g. city-limit signs), not just a dead end. */
  hasClearBoundaries: boolean;
  /** True when the candidate stays mostly outside dense urban/pedestrian context. */
  mostlyNonUrban: boolean;
}

export type FartlekDecision = "AUTO_PUBLISH" | "REVIEW" | "IGNORE" | "REJECT";

export interface ScoredFartlekCandidate {
  candidate: FartlekCandidate;
  suitabilityScore: number;
  mappingConfidence: number;
  reasons: string[];
  decision: FartlekDecision;
  rejectionReason?: string;
}

/** Builds a publishable Fartlek domain object from an AUTO_PUBLISH-scored OSM candidate. */
export const fartlekFromScoredCandidate = (scored: ScoredFartlekCandidate): import("../domain.js").Fartlek => {
  const { candidate } = scored;
  if (!candidate.name) throw new Error(`Cannot publish unnamed Fartlek candidate ${candidate.id}.`);
  const start = candidate.coordinates[0];
  const end = candidate.coordinates[candidate.coordinates.length - 1];
  return {
    id: candidate.id,
    name: candidate.name,
    geometry: { type: "LineString", coordinates: candidate.coordinates },
    startLatitude: start[1],
    startLongitude: start[0],
    endLatitude: end[1],
    endLongitude: end[0],
    lengthMeters: candidate.lengthMeters,
    status: "published",
    source: {
      sourceType: FARTLEK_SOURCE_TYPE,
      sourceExternalId: candidate.id,
      sourceAttribution: "\u00a9 OpenStreetMap contributors"
    },
    sourceMetadata: {
      sourceWayIds: candidate.sourceWayIds,
      candidateGenerationVersion: candidate.candidateGenerationVersion,
      scoringVersion: FARTLEK_SCORING_VERSION
    },
    suitabilityScore: scored.suitabilityScore,
    suitabilityReasons: scored.reasons,
    mappingConfidence: scored.mappingConfidence,
    geometryVersion: 1
  };
};
