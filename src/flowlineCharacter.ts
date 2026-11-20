/** Primary riding character of a Flowline, derived from its road-cycling style scores. */
export type FlowlineCharacterTag = "flow" | "endurance" | "explore";

export interface FlowlineCharacter {
  primary: FlowlineCharacterTag;
  /** Qualifying characters, strongest first; always contains `primary`. */
  tags: FlowlineCharacterTag[];
}

export interface FlowlineScores {
  flowScore?: number;
  enduranceScore?: number;
  exploreScore?: number;
}

/** A score at or above its threshold makes the Flowline "good for" that character. */
export const FLOWLINE_CHARACTER_THRESHOLDS: Readonly<Record<FlowlineCharacterTag, number>> = {
  flow: 70,
  endurance: 65,
  explore: 65
};

const ORDER: FlowlineCharacterTag[] = ["flow", "endurance", "explore"];

export const characterScore = (scores: FlowlineScores, tag: FlowlineCharacterTag): number | undefined =>
  tag === "flow" ? scores.flowScore : tag === "endurance" ? scores.enduranceScore : scores.exploreScore;

/**
 * Tags every character whose score reaches its threshold. The primary character is the qualifying
 * tag with the highest score; when none qualifies it is the highest score overall (flow when
 * unscored), so every Flowline has exactly one primary character.
 */
export const classifyFlowline = (scores: FlowlineScores): FlowlineCharacter => {
  const scored = ORDER
    .map((tag) => ({ tag, score: characterScore(scores, tag) }))
    .filter((entry): entry is { tag: FlowlineCharacterTag; score: number } => typeof entry.score === "number")
    .sort((a, b) => b.score - a.score || ORDER.indexOf(a.tag) - ORDER.indexOf(b.tag));
  const tags = scored.filter((entry) => entry.score >= FLOWLINE_CHARACTER_THRESHOLDS[entry.tag]).map((entry) => entry.tag);
  if (tags.length > 0) return { primary: tags[0], tags };
  const primary = scored[0]?.tag ?? "flow";
  return { primary, tags: [primary] };
};

/** Score of the Flowline's primary character; orders reveals and discoveries. */
export const primaryScore = (scores: FlowlineScores): number =>
  characterScore(scores, classifyFlowline(scores).primary) ?? 0;
