import { primaryScore, type FlowlineScores } from "./flowlineCharacter.js";
import { viewportWidthMeters } from "./flowlinePolicy.js";
import type { GeoBounds } from "./worldQuery.js";

/**
 * Flowline opportunities one "Explore this area" shows at most. Opportunities are temporary:
 * Explore persists nothing, so the same area always shows the same opportunities.
 */
export const FLOWLINE_OPPORTUNITIES_PER_EXPLORE = 12;
/** Viewports wider than this must zoom in before exploring ("Zoom in to explore"). */
export const MAX_EXPLORE_WIDTH_METERS = 50_000;
/** Minimum primary-character score of a Flowline worth showing as an opportunity. */
export const MIN_OPPORTUNITY_SCORE = 50;
/** Minimum road quality, when scored. */
export const MIN_OPPORTUNITY_ROAD_QUALITY = 40;
/** Minimum data confidence, when scored. */
export const MIN_OPPORTUNITY_DATA_CONFIDENCE = 40;

export interface OpportunityCandidate extends FlowlineScores {
  id: string;
  roadQualityScore?: number;
  dataConfidence?: number;
}

/** Published Flowlines Explore may show: good enough to ride and trustworthy enough to show. */
export const isOpportunityEligible = (candidate: OpportunityCandidate): boolean =>
  primaryScore(candidate) >= MIN_OPPORTUNITY_SCORE
  && (candidate.roadQualityScore === undefined || candidate.roadQualityScore >= MIN_OPPORTUNITY_ROAD_QUALITY)
  && (candidate.dataConfidence === undefined || candidate.dataConfidence >= MIN_OPPORTUNITY_DATA_CONFIDENCE);

const byPrimaryScore = (a: OpportunityCandidate, b: OpportunityCandidate) =>
  primaryScore(b) - primaryScore(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Eligible candidates not in `excludedIds` (the player's completed Flowlines), best first, ties by id. */
export const availableOpportunities = <T extends OpportunityCandidate>(candidates: T[], excludedIds: ReadonlySet<string>): T[] =>
  candidates.filter((candidate) => !excludedIds.has(candidate.id) && isOpportunityEligible(candidate)).sort(byPrimaryScore);

/** The Flowline opportunities one Explore shows, up to the cap. */
export const selectFlowlineOpportunities = <T extends OpportunityCandidate>(
  candidates: T[],
  excludedIds: ReadonlySet<string>,
  count: number = FLOWLINE_OPPORTUNITIES_PER_EXPLORE
): T[] => availableOpportunities(candidates, excludedIds).slice(0, Math.max(0, count));

/**
 * Flowlines a route may use: the area's eligible opportunities and the player's completed ones.
 * Planning is stateless, so this replaces any persisted reveal check.
 */
export const isPlannableFlowline = (candidate: OpportunityCandidate, completed: boolean): boolean =>
  completed || isOpportunityEligible(candidate);

export const exploreAllowed = (bounds: GeoBounds): boolean => viewportWidthMeters(bounds) <= MAX_EXPLORE_WIDTH_METERS;

export type ExploreOutcome = "discovered" | "nothing_new";

export const exploreOutcome = (opportunities: number): ExploreOutcome => (opportunities > 0 ? "discovered" : "nothing_new");
