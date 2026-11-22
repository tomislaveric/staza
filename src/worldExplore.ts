import type { Fartlek, WorldCollectible, WorldFartlek } from "./domain.js";
import { UserInputError } from "./errors.js";
import type { FlowlineCharacterTag } from "./flowlineCharacter.js";
import {
  availableOpportunities,
  clampExploreBounds,
  exploreOutcome,
  type ExploreFrame,
  FLOWLINE_OPPORTUNITIES_PER_EXPLORE,
  type ExploreOutcome,
  type OpportunityCandidate
} from "./flowlineReveal.js";
import { parseBoundsParameter, type GeoBounds } from "./worldQuery.js";

export interface WorldExploreDependencies {
  flowlines: {
    /** Scores of the published Flowlines in the area the player has not completed; never geometry. */
    listOpportunityCandidates(playerId: string, bounds: GeoBounds): Promise<OpportunityCandidate[]>;
    listByIds(flowlineIds: string[]): Promise<Fartlek[]>;
  };
  /** The area's collectibles the player has not collected yet. */
  listUncollectedCollectibles(playerId: string, bounds: GeoBounds): Promise<{ collectibles: WorldCollectible[]; truncated: boolean }>;
  /** Projects Flowlines with the player's completion state. */
  toWorld(playerId: string, flowlines: Fartlek[]): Promise<WorldFartlek[]>;
}

/** Temporary opportunities of one Explore session. Nothing here is persisted. */
export interface WorldExploreResult {
  outcome: ExploreOutcome;
  /** The explored area: the viewport, or a centered max-size frame when it was larger. */
  area: { bbox: string; center: ExploreFrame["center"]; clamped: boolean };
  /** Flowline opportunities of the area, best first. */
  flowlines: WorldFartlek[];
  /** Uncollected collectibles of the area. */
  collectibles: WorldCollectible[];
  collectiblesTruncated: boolean;
  /** Eligible Flowlines beyond the per-Explore cap. */
  availableCount: number;
  summary: { total: number; byCharacter: Record<FlowlineCharacterTag, number>; collectibles: number };
}

/** `{ bbox }` with the same "minLon,minLat,maxLon,maxLat" format as `GET /api/world`. */
/** Larger viewports are never rejected: they are clamped to a centered max-size frame. */
export const parseExploreRequest = (body: unknown): ExploreFrame => {
  const bbox = typeof body === "object" && body !== null ? (body as Record<string, unknown>).bbox : undefined;
  const bounds = parseBoundsParameter(bbox);
  if (!bounds) throw new UserInputError("An area to explore is required.");
  return clampExploreBounds(bounds);
};

const bboxString = ({ minLongitude, minLatitude, maxLongitude, maxLatitude }: GeoBounds) =>
  [minLongitude, minLatitude, maxLongitude, maxLatitude].map((value) => Number(value.toFixed(6))).join(",");

/**
 * "Explore this area": shows the area's opportunities (eligible Flowlines the player has not
 * ridden and uncollected collectibles) for this session only. It never writes: only saving an
 * Exploration or an activity creates persistent world state.
 */
export const exploreArea = async (
  playerId: string,
  body: unknown,
  { flowlines, listUncollectedCollectibles, toWorld }: WorldExploreDependencies
): Promise<WorldExploreResult> => {
  const frame = parseExploreRequest(body);
  const { bounds } = frame;
  const [candidates, area] = await Promise.all([
    flowlines.listOpportunityCandidates(playerId, bounds),
    listUncollectedCollectibles(playerId, bounds)
  ]);
  const available = availableOpportunities(candidates, new Set());
  const selected = available.slice(0, FLOWLINE_OPPORTUNITIES_PER_EXPLORE);
  const order = new Map(selected.map((candidate, index) => [candidate.id, index]));
  const loaded = (await flowlines.listByIds(selected.map((candidate) => candidate.id)))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const opportunities = await toWorld(playerId, loaded);
  const byCharacter: Record<FlowlineCharacterTag, number> = { flow: 0, endurance: 0, explore: 0 };
  for (const flowline of opportunities) byCharacter[flowline.character.primary] += 1;
  return {
    outcome: exploreOutcome(opportunities.length + area.collectibles.length),
    area: { bbox: bboxString(bounds), center: frame.center, clamped: frame.clamped },
    flowlines: opportunities,
    collectibles: area.collectibles,
    collectiblesTruncated: area.truncated,
    availableCount: available.length - opportunities.length,
    summary: { total: opportunities.length, byCharacter, collectibles: area.collectibles.length }
  };
};
