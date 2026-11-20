import type { Fartlek, WorldFartlek } from "./domain.js";
import { UserInputError } from "./errors.js";
import type { FlowlineCharacterTag } from "./flowlineCharacter.js";
import {
  availableToReveal,
  exploreAllowed,
  exploreOutcome,
  FLOWLINES_REVEALED_PER_EXPLORE,
  type ExploreOutcome,
  type RevealCandidate
} from "./flowlineReveal.js";
import { parseBoundsParameter, type GeoBounds } from "./worldQuery.js";

export interface WorldExploreDependencies {
  reveals: {
    listRevealedWithinBounds(playerId: string, bounds: GeoBounds): Promise<Fartlek[]>;
    listHiddenCandidatesWithinBounds(playerId: string, bounds: GeoBounds): Promise<RevealCandidate[]>;
    reveal(playerId: string, flowlineIds: string[], source: "explore"): Promise<string[]>;
    listByIds(flowlineIds: string[]): Promise<Fartlek[]>;
  };
  /** Projects Flowlines with the player's completion state. */
  toWorld(playerId: string, flowlines: Fartlek[]): Promise<WorldFartlek[]>;
}

export interface WorldExploreResult {
  outcome: ExploreOutcome;
  /** Flowlines this Explore revealed for the first time, best first. */
  revealed: WorldFartlek[];
  /** Every revealed Flowline in the area after this Explore, including `revealed`. */
  known: WorldFartlek[];
  /** Revealed Flowlines in the area after this Explore. */
  knownCount: number;
  /** Eligible Flowlines still hidden after this Explore (beyond the per-Explore cap). */
  availableCount: number;
  summary: { total: number; byCharacter: Record<FlowlineCharacterTag, number> };
}

/** `{ bbox }` with the same "minLon,minLat,maxLon,maxLat" format as `GET /api/world`. */
export const parseExploreRequest = (body: unknown): GeoBounds => {
  const bbox = typeof body === "object" && body !== null ? (body as Record<string, unknown>).bbox : undefined;
  const bounds = parseBoundsParameter(bbox);
  if (!bounds) throw new UserInputError("An area to explore is required.");
  if (!exploreAllowed(bounds)) throw new UserInputError("This area is too large to explore. Zoom in and try again.");
  return bounds;
};

/**
 * "Explore this area": reveals the area's eligible hidden Flowlines to the player. It never
 * routes, never touches collectibles and never re-reveals known Flowlines; reveals are permanent.
 */
export const exploreArea = async (
  playerId: string,
  body: unknown,
  { reveals, toWorld }: WorldExploreDependencies
): Promise<WorldExploreResult> => {
  const bounds = parseExploreRequest(body);
  const [knownBefore, hidden] = await Promise.all([
    reveals.listRevealedWithinBounds(playerId, bounds),
    reveals.listHiddenCandidatesWithinBounds(playerId, bounds)
  ]);
  const available = availableToReveal(hidden, new Set());
  const selected = available.slice(0, FLOWLINES_REVEALED_PER_EXPLORE);
  const newlyRevealed = new Set(await reveals.reveal(playerId, selected.map((candidate) => candidate.id), "explore"));
  const order = new Map(selected.map((candidate, index) => [candidate.id, index]));
  const flowlines = (await reveals.listByIds([...newlyRevealed]))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const [revealed, knownWorld] = await Promise.all([toWorld(playerId, flowlines), toWorld(playerId, knownBefore)]);
  const byCharacter: Record<FlowlineCharacterTag, number> = { flow: 0, endurance: 0, explore: 0 };
  for (const flowline of revealed) byCharacter[flowline.character.primary] += 1;
  return {
    outcome: exploreOutcome(knownBefore.length, revealed.length),
    revealed,
    known: [...knownWorld, ...revealed],
    knownCount: knownBefore.length + revealed.length,
    availableCount: available.length - revealed.length,
    summary: { total: revealed.length, byCharacter }
  };
};
