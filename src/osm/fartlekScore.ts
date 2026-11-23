import type { FartlekDecision, FartlekCandidate, ScoredFartlekCandidate } from "./fartlekModel.js";
import {
  calculateRoadCyclingFlowlineQuality,
  shouldPublishRoadCyclingFlowline,
  type RoadCyclingFlowlineQuality
} from "./roadCyclingFlowlineQuality.js";

export const scoreFartlekCandidate = (candidate: FartlekCandidate): ScoredFartlekCandidate => {
  const quality = calculateRoadCyclingFlowlineQuality(candidate);
  const decision = classifyFartlekScore(quality);

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

export const classifyFartlekScore = (quality: RoadCyclingFlowlineQuality): FartlekDecision =>
  quality.rejectionReason || !quality.trafficComfort.allowed ? "REJECT" :
    shouldPublishRoadCyclingFlowline(quality) ? "AUTO_PUBLISH" :
      quality.qualityScore >= 50 || quality.dataConfidence >= 45 ? "REVIEW" : "IGNORE";
