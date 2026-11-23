/** Primary riding character of a Flowline, derived from its road-cycling style scores. */
export type FlowlineCharacterTag = "flow" | "endurance" | "explore";

export interface FlowlineCharacter {
  primary: FlowlineCharacterTag | null;
  /** One qualifying character, or none for a plain Flowline. */
  tags: FlowlineCharacterTag[];
  policyVersion?: number;
}

export interface FlowlineScores {
  lengthMeters?: number;
  flowScore?: number;
  enduranceScore?: number;
  exploreScore?: number;
}

export const FLOWLINE_CHARACTER_POLICY_VERSION = 2;
export const FLOWLINE_CHARACTER_LENGTH_METERS = 5_000;

/** Flow is strictly above its floor; Endurance/Explore include their threshold. */
export const FLOWLINE_CHARACTER_THRESHOLDS: Readonly<Record<FlowlineCharacterTag, number>> = {
  flow: 82,
  endurance: 65,
  explore: 65
};

const validScore = (score: number | undefined): score is number =>
  score !== undefined && Number.isFinite(score) && score >= 0 && score <= 100;

export const characterScore = (scores: FlowlineScores, tag: FlowlineCharacterTag): number | undefined =>
  tag === "flow" ? scores.flowScore : tag === "endurance" ? scores.enduranceScore : scores.exploreScore;

export const classifyFlowline = (scores: FlowlineScores): FlowlineCharacter => {
  const { lengthMeters, flowScore, enduranceScore, exploreScore } = scores;
  const validLength = lengthMeters !== undefined && Number.isFinite(lengthMeters) && lengthMeters > 0;
  const primary: FlowlineCharacterTag | null =
    validLength && lengthMeters < FLOWLINE_CHARACTER_LENGTH_METERS &&
      validScore(flowScore) && flowScore > FLOWLINE_CHARACTER_THRESHOLDS.flow ? "flow" :
      validLength && lengthMeters >= FLOWLINE_CHARACTER_LENGTH_METERS &&
        validScore(enduranceScore) && enduranceScore >= FLOWLINE_CHARACTER_THRESHOLDS.endurance ? "endurance" :
        validScore(exploreScore) && exploreScore >= FLOWLINE_CHARACTER_THRESHOLDS.explore ? "explore" : null;
  return { primary, tags: primary ? [primary] : [], policyVersion: FLOWLINE_CHARACTER_POLICY_VERSION };
};

/** Preserve historical score selection independently of the new badge policy. */
export const opportunityScore = (scores: FlowlineScores): number => {
  const entries = [
    { score: scores.flowScore, threshold: 70 },
    { score: scores.enduranceScore, threshold: 65 },
    { score: scores.exploreScore, threshold: 65 }
  ].filter((entry): entry is { score: number; threshold: number } => validScore(entry.score));
  const qualifying = entries.filter(({ score, threshold }) => score >= threshold);
  return Math.max(0, ...(qualifying.length ? qualifying : entries).map(({ score }) => score));
};
