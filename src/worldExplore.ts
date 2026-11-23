import type { Fartlek, WorldCollectible, WorldFartlek } from "./domain.js";
import { UserInputError } from "./errors.js";
import type { FlowlineCharacterTag } from "./flowlineCharacter.js";
import {
  availableOpportunities,
  clampExploreBounds,
  clampExploreCircle,
  type ExploreCircle,
  exploreOutcome,
  type ExploreFrame,
  FLOWLINE_OPPORTUNITIES_PER_EXPLORE,
  type ExploreOutcome,
  lineTouchesCircle,
  type OpportunityCandidate,
  pointInCircle
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
  area: { bbox: string; center: ExploreFrame["center"]; clamped: boolean; circle?: ExploreCircle };
  /** Flowline opportunities of the area, best first. */
  flowlines: WorldFartlek[];
  /** Uncollected collectibles of the area. */
  collectibles: WorldCollectible[];
  collectiblesTruncated: boolean;
  /** Eligible Flowlines beyond the per-Explore cap (an upper bound for circular areas). */
  availableCount: number;
  summary: { total: number; byCharacter: Record<FlowlineCharacterTag, number>; unclassifiedFlowlineCount: number; collectibles: number };
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const parseCircle = (value: unknown): ExploreCircle => {
  const circle = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const center = typeof circle.center === "object" && circle.center !== null ? circle.center as Record<string, unknown> : {};
  const { lat, lon } = center;
  const { radiusMeters } = circle;
  if (!finite(lat) || !finite(lon) || !finite(radiusMeters) || Math.abs(lat) > 85 || Math.abs(lon) > 180 || radiusMeters <= 0) {
    throw new UserInputError("The circle to explore is invalid.");
  }
  return { center: { lat, lon }, radiusMeters };
};

/**
 * `{ circle: { center: { lat, lon }, radiusMeters } }`, or `{ bbox }` with the same
 * "minLon,minLat,maxLon,maxLat" format as `GET /api/world`. Larger areas are never rejected:
 * circles are capped at the maximum radius, viewports clamped to a centered max-size frame.
 */
export const parseExploreRequest = (body: unknown): ExploreFrame => {
  const request = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  if (request.circle !== undefined) return clampExploreCircle(parseCircle(request.circle));
  const bounds = parseBoundsParameter(request.bbox);
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
  const { loaded, outside } = await loadOpportunities(available, frame.circle, flowlines.listByIds);
  const opportunities = await toWorld(playerId, loaded);
  const collectibles = frame.circle
    ? area.collectibles.filter((item) => pointInCircle(frame.circle!, item.longitude, item.latitude))
    : area.collectibles;
  const byCharacter: Record<FlowlineCharacterTag, number> = { flow: 0, endurance: 0, explore: 0 };
  let unclassifiedFlowlineCount = 0;
  for (const flowline of opportunities) {
    const { primary } = flowline.character;
    if (primary === null) unclassifiedFlowlineCount += 1;
    else byCharacter[primary] += 1;
  }
  return {
    outcome: exploreOutcome(opportunities.length + collectibles.length),
    area: {
      bbox: bboxString(bounds),
      center: frame.center,
      clamped: frame.clamped,
      ...(frame.circle ? { circle: frame.circle } : {})
    },
    flowlines: opportunities,
    collectibles,
    collectiblesTruncated: area.truncated,
    availableCount: available.length - outside - opportunities.length,
    summary: { total: opportunities.length, byCharacter, unclassifiedFlowlineCount, collectibles: collectibles.length }
  };
};

/** Batches of candidate geometry loaded while filling a circular area's Flowlines. */
const CIRCLE_LOAD_BATCH = FLOWLINE_OPPORTUNITIES_PER_EXPLORE * 2;

/**
 * The best opportunities up to the cap, in score order. A circle loads candidates (found by their
 * bounding boxes) in batches and keeps those whose line reaches into the circle.
 */
const loadOpportunities = async (
  available: OpportunityCandidate[],
  circle: ExploreCircle | undefined,
  listByIds: (ids: string[]) => Promise<Fartlek[]>
): Promise<{ loaded: Fartlek[]; outside: number }> => {
  const inOrder = (items: Fartlek[], ids: string[]) => {
    const order = new Map(ids.map((id, index) => [id, index]));
    return items.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  };
  if (!circle) {
    const ids = available.slice(0, FLOWLINE_OPPORTUNITIES_PER_EXPLORE).map((candidate) => candidate.id);
    return { loaded: inOrder(await listByIds(ids), ids), outside: 0 };
  }
  const loaded: Fartlek[] = [];
  let outside = 0;
  for (let start = 0; start < available.length && loaded.length < FLOWLINE_OPPORTUNITIES_PER_EXPLORE; start += CIRCLE_LOAD_BATCH) {
    const ids = available.slice(start, start + CIRCLE_LOAD_BATCH).map((candidate) => candidate.id);
    for (const item of inOrder(await listByIds(ids), ids)) {
      if (!lineTouchesCircle(circle, item.geometry.coordinates)) outside += 1;
      else if (loaded.length < FLOWLINE_OPPORTUNITIES_PER_EXPLORE) loaded.push(item);
    }
  }
  return { loaded, outside };
};
