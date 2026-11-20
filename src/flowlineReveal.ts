import { primaryScore, type FlowlineScores } from "./flowlineCharacter.js";
import { viewportWidthMeters } from "./flowlinePolicy.js";
import type { GeoBounds } from "./worldQuery.js";

/** Flowlines one "Explore this area" reveals at most; the rest wait for the next Explore. */
export const FLOWLINES_REVEALED_PER_EXPLORE = 12;
/** Viewports wider than this must zoom in before exploring ("Zoom in to explore"). */
export const MAX_EXPLORE_WIDTH_METERS = 50_000;
/** Minimum primary-character score of a Flowline worth discovering. */
export const MIN_REVEAL_SCORE = 50;
/** Minimum road quality, when scored. */
export const MIN_REVEAL_ROAD_QUALITY = 40;
/** Minimum data confidence, when scored. */
export const MIN_REVEAL_DATA_CONFIDENCE = 40;

export interface RevealCandidate extends FlowlineScores {
  id: string;
  roadQualityScore?: number;
  dataConfidence?: number;
}

/** Published Flowlines Explore may reveal: good enough to ride and trustworthy enough to show. */
export const isRevealEligible = (candidate: RevealCandidate): boolean =>
  primaryScore(candidate) >= MIN_REVEAL_SCORE
  && (candidate.roadQualityScore === undefined || candidate.roadQualityScore >= MIN_REVEAL_ROAD_QUALITY)
  && (candidate.dataConfidence === undefined || candidate.dataConfidence >= MIN_REVEAL_DATA_CONFIDENCE);

const byPrimaryScore = (a: RevealCandidate, b: RevealCandidate) =>
  primaryScore(b) - primaryScore(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Eligible unrevealed candidates, best primary score first, ties by id. */
export const availableToReveal = <T extends RevealCandidate>(candidates: T[], revealedIds: ReadonlySet<string>): T[] =>
  candidates.filter((candidate) => !revealedIds.has(candidate.id) && isRevealEligible(candidate)).sort(byPrimaryScore);

/**
 * The Flowlines one Explore reveals: every eligible unrevealed Flowline of the area up to the cap,
 * so the same area always reveals the same Flowlines in the same order.
 */
export const selectFlowlinesToReveal = <T extends RevealCandidate>(
  candidates: T[],
  revealedIds: ReadonlySet<string>,
  count: number = FLOWLINES_REVEALED_PER_EXPLORE
): T[] => availableToReveal(candidates, revealedIds).slice(0, Math.max(0, count));

export const exploreAllowed = (bounds: GeoBounds): boolean => viewportWidthMeters(bounds) <= MAX_EXPLORE_WIDTH_METERS;

/** Derived "explored" state of a viewport; there is no stored explored-area record. */
export interface FlowlineAreaStatus {
  exploreAllowed: boolean;
  /** Revealed Flowlines in the area. */
  knownFlowlines: number;
  /** Eligible hidden Flowlines Explore would reveal (before the per-Explore cap). */
  availableFlowlines: number;
}

export const flowlineAreaStatus = (
  bounds: GeoBounds,
  knownFlowlines: number,
  hiddenCandidates: RevealCandidate[]
): FlowlineAreaStatus => ({
  exploreAllowed: exploreAllowed(bounds),
  knownFlowlines,
  availableFlowlines: availableToReveal(hiddenCandidates, new Set()).length
});

export type ExploreOutcome = "discovered" | "already_explored_new" | "already_explored" | "nothing_new";

/** First reveal, top-up of an explored area, an explored area without news, or nothing at all. */
export const exploreOutcome = (knownBefore: number, revealed: number): ExploreOutcome =>
  revealed > 0
    ? (knownBefore > 0 ? "already_explored_new" : "discovered")
    : (knownBefore > 0 ? "already_explored" : "nothing_new");
