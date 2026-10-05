import type {
  Activity,
  ActivityType,
  Collectible,
  QuestProgress,
  QuestRoute,
  TrackPoint
} from "./domain.js";
import { UserInputError } from "./errors.js";
import { distanceMeters } from "./geometry.js";

export const MAX_QUEST_TITLE_LENGTH = 120;
export const MAX_QUEST_DESCRIPTION_LENGTH = 2000;
export const MAX_QUEST_COLLECTIBLES = 50;

export const deriveQuestProgress = (
  questCollectibleIds: Iterable<string>,
  collectedSourceIds: Iterable<string>
): QuestProgress => {
  const questIds = new Set(questCollectibleIds);
  const collected = new Set(collectedSourceIds);
  let collectedCount = 0;
  for (const id of questIds) if (collected.has(id)) collectedCount += 1;
  return {
    collected: collectedCount,
    total: questIds.size,
    ratio: questIds.size === 0 ? 0 : collectedCount / questIds.size,
    complete: questIds.size > 0 && collectedCount === questIds.size
  };
};

export const deriveQuestCenter = (
  collectibles: Pick<Collectible, "latitude" | "longitude">[],
  route?: QuestRoute
): { latitude: number; longitude: number } => {
  const points = collectibles.length > 0
    ? collectibles.map((collectible) => ({ latitude: collectible.latitude, longitude: collectible.longitude }))
    : (route?.geometry.coordinates ?? []).map(([longitude, latitude]) => ({ latitude, longitude }));
  if (points.length === 0) {
    throw new UserInputError("A quest needs at least one collectible or a route to be placed in the world.");
  }
  const total = points.reduce(
    (sum, point) => ({ latitude: sum.latitude + point.latitude, longitude: sum.longitude + point.longitude }),
    { latitude: 0, longitude: 0 }
  );
  return {
    latitude: total.latitude / points.length,
    longitude: total.longitude / points.length
  };
};

const perpendicularDistanceMeters = (
  point: TrackPoint,
  start: TrackPoint,
  end: TrackPoint
): number => {
  const radians = Math.PI / 180;
  const earthRadiusM = 6_371_000;
  const scale = Math.cos(start.latitude * radians);
  const toLocal = (value: TrackPoint) => ({
    x: (value.longitude - start.longitude) * radians * earthRadiusM * scale,
    y: (value.latitude - start.latitude) * radians * earthRadiusM
  });
  const target = toLocal(point);
  const line = toLocal(end);
  const lengthSquared = line.x ** 2 + line.y ** 2;
  if (lengthSquared === 0) return Math.hypot(target.x, target.y);
  const projection = Math.max(0, Math.min(1, (target.x * line.x + target.y * line.y) / lengthSquared));
  return Math.hypot(target.x - line.x * projection, target.y - line.y * projection);
};

const simplifySegment = (points: TrackPoint[], toleranceMeters: number): TrackPoint[] => {
  if (points.length < 3) return points;
  let maximumDistance = 0;
  let index = 0;
  for (let candidate = 1; candidate < points.length - 1; candidate += 1) {
    const distance = perpendicularDistanceMeters(points[candidate], points[0], points[points.length - 1]);
    if (distance > maximumDistance) {
      maximumDistance = distance;
      index = candidate;
    }
  }
  if (maximumDistance <= toleranceMeters) return [points[0], points[points.length - 1]];
  return [
    ...simplifySegment(points.slice(0, index + 1), toleranceMeters).slice(0, -1),
    ...simplifySegment(points.slice(index), toleranceMeters)
  ];
};

export const simplifyRoute = (
  route: TrackPoint[],
  maximumPoints: number,
  initialToleranceMeters = 2
): TrackPoint[] => {
  if (route.length <= maximumPoints) return route;
  let tolerance = initialToleranceMeters;
  let simplified = simplifySegment(route, tolerance);
  while (simplified.length > maximumPoints && tolerance < 10_000) {
    tolerance *= 2;
    simplified = simplifySegment(route, tolerance);
  }
  if (simplified.length <= maximumPoints) return simplified;
  const step = Math.ceil(simplified.length / maximumPoints);
  const sampled = simplified.filter((_point, index) => index % step === 0);
  const last = simplified[simplified.length - 1];
  if (sampled[sampled.length - 1] !== last) sampled.push(last);
  return sampled;
};

export const routeLengthMeters = (route: Pick<TrackPoint, "latitude" | "longitude">[]): number => {
  let total = 0;
  for (let index = 1; index < route.length; index += 1) {
    total += distanceMeters(
      route[index - 1].latitude,
      route[index - 1].longitude,
      route[index].latitude,
      route[index].longitude
    );
  }
  return total;
};

export const createQuestRouteSnapshot = (
  activity: Pick<Activity, "id" | "type" | "route" | "distance">,
  maximumPoints: number
): QuestRoute | undefined => {
  if (!Array.isArray(activity.route) || activity.route.length < 2) return undefined;
  const simplified = simplifyRoute(activity.route, maximumPoints);
  const distance = activity.distance ?? routeLengthMeters(simplified);
  return {
    sourceActivityId: activity.id,
    geometry: {
      type: "LineString",
      coordinates: simplified.map((point) => [
        Number(point.longitude.toFixed(6)),
        Number(point.latitude.toFixed(6))
      ] as [number, number])
    },
    ...(Number.isFinite(distance) ? { distanceMeters: distance } : {}),
    activityType: activity.type
  };
};

export interface ParsedQuestInput {
  title: string;
  description?: string;
  collectibleIds: string[];
  sourceActivityId?: string;
}

export const parseQuestInput = (body: unknown, options: { requireTitle: boolean }): ParsedQuestInput => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new UserInputError("A quest payload must be an object.");
  }
  const candidate = body as Record<string, unknown>;
  let title: string | undefined;
  if (candidate.title !== undefined) {
    if (typeof candidate.title !== "string" || candidate.title.trim() === "") {
      throw new UserInputError("A quest needs a nonblank title.");
    }
    if (candidate.title.trim().length > MAX_QUEST_TITLE_LENGTH) {
      throw new UserInputError(`A quest title must be at most ${MAX_QUEST_TITLE_LENGTH} characters.`);
    }
    title = candidate.title.trim();
  } else if (options.requireTitle) {
    throw new UserInputError("A quest needs a nonblank title.");
  }

  let description: string | undefined;
  if (candidate.description !== undefined && candidate.description !== null) {
    if (typeof candidate.description !== "string") {
      throw new UserInputError("A quest description must be a string.");
    }
    if (candidate.description.length > MAX_QUEST_DESCRIPTION_LENGTH) {
      throw new UserInputError(`A quest description must be at most ${MAX_QUEST_DESCRIPTION_LENGTH} characters.`);
    }
    description = candidate.description.trim();
  }

  let collectibleIds: string[] = [];
  if (candidate.collectibleIds !== undefined) {
    if (!Array.isArray(candidate.collectibleIds)
      || candidate.collectibleIds.some((id) => typeof id !== "string" || id.trim() === "")) {
      throw new UserInputError("Quest collectible ids must be a list of nonblank strings.");
    }
    collectibleIds = [...new Set(candidate.collectibleIds as string[])];
    if (collectibleIds.length > MAX_QUEST_COLLECTIBLES) {
      throw new UserInputError(`A quest can contain at most ${MAX_QUEST_COLLECTIBLES} collectibles.`);
    }
  } else if (options.requireTitle) {
    throw new UserInputError("Quest collectible ids must be a list of nonblank strings.");
  }

  if (candidate.sourceActivityId !== undefined && candidate.sourceActivityId !== null
    && (typeof candidate.sourceActivityId !== "string" || candidate.sourceActivityId.trim() === "")) {
    throw new UserInputError("A source activity id must be a nonblank string when provided.");
  }

  return {
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    collectibleIds,
    ...(typeof candidate.sourceActivityId === "string" ? { sourceActivityId: candidate.sourceActivityId.trim() } : {})
  } as ParsedQuestInput;
};

export const suggestQuestTitle = (type: ActivityType, startedAt: string): string => {
  const labels: Record<ActivityType, string> = {
    cycling: "Ride",
    running: "Run",
    hiking: "Hike",
    walking: "Walk",
    unknown: "Activity"
  };
  const date = new Date(startedAt);
  const formatted = Number.isNaN(date.getTime())
    ? ""
    : ` \u00b7 ${date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`;
  return `${labels[type] ?? labels.unknown}${formatted}`;
};
