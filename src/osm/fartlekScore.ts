import type { FartlekDecision, FartlekCandidate, ScoredFartlekCandidate } from "./fartlekModel.js";
import {
  calculateRoadCyclingFlowlineQuality,
  ROAD_CYCLING_MIN_DATA_CONFIDENCE,
  ROAD_CYCLING_MIN_QUALITY_SCORE,
  shouldPublishRoadCyclingFlowline
} from "./roadCyclingFlowlineQuality.js";

export const scoreFartlekCandidate = (candidate: FartlekCandidate): ScoredFartlekCandidate => {
  const quality = calculateRoadCyclingFlowlineQuality(candidate);
  const decision: FartlekDecision = quality.rejectionReason
    ? "REJECT"
    : shouldPublishRoadCyclingFlowline(quality)
      ? "AUTO_PUBLISH"
      : quality.qualityScore >= 50 || quality.dataConfidence >= 45
        ? "REVIEW"
        : "IGNORE";

  return {
    candidate,
    suitabilityScore: quality.qualityScore,
    mappingConfidence: quality.dataConfidence,
    reasons: quality.reasons,
    decision,
    scores: quality.scores,
    ...(quality.rejectionReason ? { rejectionReason: quality.rejectionReason } : {})
  };
};

export const classifyFartlekScore = (score: number, mappingConfidence: number): FartlekDecision =>
  score >= ROAD_CYCLING_MIN_QUALITY_SCORE && mappingConfidence >= ROAD_CYCLING_MIN_DATA_CONFIDENCE
    ? "AUTO_PUBLISH"
    : score >= 50 || mappingConfidence >= 45
      ? "REVIEW"
      : "IGNORE";
