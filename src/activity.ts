import type { Activity, ActivityResult, ActivityType, Collectible, GameEvent, NearMissCollectible, TrackPoint } from "./domain.js";
import type { FitMetadata } from "./fit.js";
import { distanceMeters, detectFirstCollectiblePassages, minimumRouteDistanceMeters } from "./geometry.js";
import { JourneyBoundaryError } from "./errors.js";

export const NEAR_MISS_THRESHOLD_METERS = 200;
export const MAX_NEAR_MISSES = 5;

const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  cycling: "Ride",
  running: "Run",
  hiking: "Hike",
  walking: "Walk",
  unknown: "Activity"
};

/** A human label for an activity type, used as a title fallback when the FIT carries no name. */
export const activityTypeLabel = (type: ActivityType): string => ACTIVITY_TYPE_LABELS[type] ?? ACTIVITY_TYPE_LABELS.unknown;

export const validateActivityImportEligibility = (
  journeyStartedAt: number | Date | string | null | undefined,
  activityStartedAt: number | Date | string
): void => {
  if (journeyStartedAt == null) return;
  const boundary = journeyStartedAt instanceof Date ? journeyStartedAt.getTime()
    : typeof journeyStartedAt === "number" ? journeyStartedAt : Date.parse(journeyStartedAt);
  const startedAt = typeof activityStartedAt === "number" ? activityStartedAt
    : activityStartedAt instanceof Date ? activityStartedAt.getTime() : Date.parse(activityStartedAt);
  if (!Number.isFinite(boundary) || !Number.isFinite(startedAt)) {
    throw new Error("Activity and journey start timestamps must be valid.");
  }
  if (startedAt < boundary) throw new JourneyBoundaryError();
};

export const deriveActivity = (
  id: string,
  route: TrackPoint[],
  type: ActivityType = "unknown",
  metadata: FitMetadata = {},
  source: Activity["source"] = "fit"
): Activity => {
  const distance = route.slice(1).reduce(
    (total, point, index) =>
      total + distanceMeters(route[index].latitude, route[index].longitude, point.latitude, point.longitude),
    0
  );
  const startedAt = route[0].timestampMs;
  const endedAt = route.at(-1)!.timestampMs;
  const title = metadata.title ?? activityTypeLabel(type);
  return {
    id,
    source,
    type,
    title,
    ...(metadata.description === undefined ? {} : { description: metadata.description }),
    startedAt,
    endedAt,
    route,
    distance,
    duration: Math.max(0, (endedAt - startedAt) / 1000)
  };
};

export const deriveNearMisses = (
  activity: Activity,
  collectibles: Collectible[],
  events: GameEvent[]
): NearMissCollectible[] => {
  const collectedIds = new Set(events.map((event) => event.sourceId));
  return collectibles
    .filter((collectible) => !collectedIds.has(collectible.id))
    .map((collectible) => ({
      collectibleId: collectible.id,
      name: collectible.name,
      value: collectible.value,
      ...(collectible.rarity === undefined ? {} : { rarity: collectible.rarity }),
      minimumDistanceMeters: minimumRouteDistanceMeters(activity.route, collectible)
    }))
    .filter((collectible) => collectible.minimumDistanceMeters <= NEAR_MISS_THRESHOLD_METERS)
    .sort((left, right) => left.minimumDistanceMeters - right.minimumDistanceMeters)
    .slice(0, MAX_NEAR_MISSES);
};

export const deriveActivityResult = (activity: Activity, collectibles: Collectible[]): ActivityResult => {
  const passages = detectFirstCollectiblePassages(activity.route, collectibles);
  const events: GameEvent[] = passages.map((passage) => ({
    id: passage.collectible.id,
    sourceId: passage.collectible.id,
    type: "collectible_collected",
    collectible: {
      name: passage.collectible.name,
      type: passage.collectible.type,
      ...(passage.collectible.rarity === undefined ? {} : { rarity: passage.collectible.rarity })
    },
    value: passage.collectible.value,
    latitude: passage.collectible.latitude,
    longitude: passage.collectible.longitude,
    activityTimestamp: passage.timestampMs
  }));
  return {
    activityId: activity.id,
    distance: activity.distance,
    duration: activity.duration,
    collectedCount: events.length,
    totalPoints: events.reduce((total, event) => total + event.value, 0),
    collectibles,
    events,
    nearMisses: deriveNearMisses(activity, collectibles, events)
  };
};
