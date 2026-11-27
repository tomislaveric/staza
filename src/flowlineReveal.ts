import { opportunityScore, type FlowlineScores } from "./flowlineCharacter.js";

/** Minimum style score of a Flowline worth offering, regardless of badge. */
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

/** Published Flowlines worth offering: good enough to ride and trustworthy enough to show. */
export const isOpportunityEligible = (candidate: OpportunityCandidate): boolean =>
  opportunityScore(candidate) >= MIN_OPPORTUNITY_SCORE
  && (candidate.roadQualityScore === undefined || candidate.roadQualityScore >= MIN_OPPORTUNITY_ROAD_QUALITY)
  && (candidate.dataConfidence === undefined || candidate.dataConfidence >= MIN_OPPORTUNITY_DATA_CONFIDENCE);

/**
 * Flowlines a route may use: eligible ones and the player's completed ones.
 * Planning is stateless, so this replaces any persisted reveal check.
 */
export const isPlannableFlowline = (candidate: OpportunityCandidate, completed: boolean): boolean =>
  completed || isOpportunityEligible(candidate);
