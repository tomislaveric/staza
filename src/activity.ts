import type { Activity, ActivityResult, ActivitySource, ActivityType, Collectible, DistanceXpReward, Fartlek, GameEvent, NearMissCollectible, TrackPoint } from "./domain.js";
import type { FitMetadata } from "./fit.js";
import { distanceMeters, detectFirstCollectiblePassages, minimumRouteDistanceMeters } from "./geometry.js";
import { deriveFartlekCompletionDrafts } from "./fartlekDetection.js";
import { FARTLEK_COMPLETION_XP } from "./fartlek.js";

export const NEAR_MISS_THRESHOLD_METERS = 200;
export const MAX_NEAR_MISSES = 5;

export const BASE_ACTIVITY_XP = 50;

/** Distance XP per kilometre by sport; unknown sports and walking earn none. */
export const DISTANCE_XP_PER_KM: Record<ActivityType, number> = {
  cycling: 2,
  running: 10,
  hiking: 7,
  walking: 0,
  unknown: 0
};

const KM_EPSILON = 1e-9;

/** Distance XP for a route length, rounded once per activity. Missing distance earns none. */
export const distanceXpForActivity = (type: ActivityType, distanceMeters: number | undefined): number => {
  if (distanceMeters === undefined) return 0;
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw new RangeError("distanceMeters must be a finite, non-negative number.");
  }
  return Math.round((DISTANCE_XP_PER_KM[type] ?? 0) * distanceMeters / 1_000);
};

/** Timestamped distance rewards: one per completed km plus a final partial-km remainder; they sum to the rounded total. */
export const deriveDistanceXpRewards = (route: TrackPoint[], type: ActivityType = "unknown"): DistanceXpReward[] => {
  const rate = DISTANCE_XP_PER_KM[type] ?? 0;
  if (rate === 0 || route.length < 2) return [];

  const segments: Array<{ before: TrackPoint; after: TrackPoint; start: number; length: number }> = [];
  let total = 0;
  for (let index = 1; index < route.length; index += 1) {
    const before = route[index - 1];
    const after = route[index];
    const length = distanceMeters(before.latitude, before.longitude, after.latitude, after.longitude);
    segments.push({ before, after, start: total, length });
    total += length;
  }

  const totalXp = distanceXpForActivity(type, total);
  const wholeKm = Math.floor(total / 1_000 + KM_EPSILON);
  const rewards: DistanceXpReward[] = [];
  let segmentIndex = 0;
  for (let km = 1; km <= wholeKm; km += 1) {
    const threshold = km * 1_000;
    while (segmentIndex < segments.length - 1 && segments[segmentIndex].start + segments[segmentIndex].length < threshold) {
      segmentIndex += 1;
    }
    const segment = segments[segmentIndex];
    const fraction = segment.length > 0 ? Math.min(1, Math.max(0, (threshold - segment.start) / segment.length)) : 1;
    rewards.push({
      distanceMeters: threshold,
      xpEarned: rate,
      activityTimestampMs: segment.before.timestampMs + (segment.after.timestampMs - segment.before.timestampMs) * fraction
    });
  }

  const remainder = totalXp - rate * wholeKm;
  if (remainder > 0) {
    rewards.push({
      distanceMeters: total,
      xpEarned: remainder,
      activityTimestampMs: route[route.length - 1].timestampMs
    });
  }
  return rewards;
};

const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  cycling: "Ride",
  running: "Run",
  hiking: "Hike",
  walking: "Walk",
  unknown: "Activity"
};

/** A human label for an activity type, used as a title fallback when the FIT carries no name. */
export const activityTypeLabel = (type: ActivityType): string => ACTIVITY_TYPE_LABELS[type] ?? ACTIVITY_TYPE_LABELS.unknown;

export const deriveActivity = (
  id: string,
  route: TrackPoint[],
  type: ActivityType = "unknown",
  metadata: Partial<FitMetadata> = {},
  source: ActivitySource = "fit"
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
    duration: Math.max(0, (endedAt - startedAt) / 1000),
    ...(metadata.elevationGainM === undefined ? {} : { elevationGainM: metadata.elevationGainM })
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
      minimumDistanceMeters: minimumRouteDistanceMeters(activity.route, collectible)
    }))
    .filter((collectible) => collectible.minimumDistanceMeters <= NEAR_MISS_THRESHOLD_METERS)
    .sort((left, right) => left.minimumDistanceMeters - right.minimumDistanceMeters)
    .slice(0, MAX_NEAR_MISSES);
};

export const deriveActivityResult = (
  activity: Activity,
  collectibles: Collectible[],
  fartleks: Fartlek[] = []
): ActivityResult => {
  const passages = detectFirstCollectiblePassages(activity.route, collectibles);
  const events: GameEvent[] = passages.map((passage) => ({
    id: passage.collectible.id,
    sourceId: passage.collectible.id,
    type: "collectible_collected",
    collectible: {
      name: passage.collectible.name,
      type: passage.collectible.type
    },
    value: passage.collectible.value,
    latitude: passage.collectible.latitude,
    longitude: passage.collectible.longitude,
    activityTimestamp: passage.timestampMs
  }));
  // Flowlines are road-cycling segments; runs and hikes don't complete them.
  const fartlekCompletions = activity.type === "running" || activity.type === "hiking" || activity.type === "walking"
    ? []
    : deriveFartlekCompletionDrafts(activity.route, fartleks);
  const distanceXp = distanceXpForActivity(activity.type, activity.distance);
  const distanceXpRewards = deriveDistanceXpRewards(activity.route, activity.type);
  return {
    activityId: activity.id,
    distance: activity.distance,
    duration: activity.duration,
    collectedCount: events.length,
    totalPoints: events.reduce((total, event) => total + event.value, 0)
      + fartlekCompletions.length * FARTLEK_COMPLETION_XP
      + BASE_ACTIVITY_XP
      + distanceXp,
    baseXp: BASE_ACTIVITY_XP,
    distanceXp,
    distanceXpRewards,
    collectibles,
    events,
    nearMisses: deriveNearMisses(activity, collectibles, events),
    fartlekCompletions
  };
};
