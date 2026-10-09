import type { Activity, ActivityResult, ActivitySource, ActivityType, Collectible, DistanceXpReward, Fartlek, GameEvent, NearMissCollectible, TrackPoint } from "./domain.js";
import type { FitMetadata } from "./fit.js";
import { distanceMeters, detectFirstCollectiblePassages, minimumRouteDistanceMeters } from "./geometry.js";
import { deriveFartlekCompletionDrafts } from "./fartlekDetection.js";
import { FARTLEK_COMPLETION_XP } from "./fartlek.js";

export const NEAR_MISS_THRESHOLD_METERS = 200;
export const MAX_NEAR_MISSES = 5;

export const DISTANCE_XP_MILESTONES = [
  { distanceMeters: 10_000, xpEarned: 10 },
  { distanceMeters: 20_000, xpEarned: 20 },
  { distanceMeters: 50_000, xpEarned: 20 },
  { distanceMeters: 100_000, xpEarned: 25 },
  { distanceMeters: 150_000, xpEarned: 25 }
] as const;

export const distanceXpForMeters = (distanceMeters: number): number => {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw new RangeError("distanceMeters must be a finite, non-negative number.");
  }
  return DISTANCE_XP_MILESTONES.reduce(
    (total, milestone) => distanceMeters >= milestone.distanceMeters ? total + milestone.xpEarned : total,
    0
  );
};

export const deriveDistanceXpRewards = (route: TrackPoint[]): DistanceXpReward[] => {
  const rewards: DistanceXpReward[] = [];
  let distanceBeforeSegment = 0;
  let milestoneIndex = 0;

  for (let index = 1; index < route.length && milestoneIndex < DISTANCE_XP_MILESTONES.length; index += 1) {
    const before = route[index - 1];
    const after = route[index];
    const segmentDistance = distanceMeters(before.latitude, before.longitude, after.latitude, after.longitude);
    const distanceAfterSegment = distanceBeforeSegment + segmentDistance;

    while (
      milestoneIndex < DISTANCE_XP_MILESTONES.length
      && distanceAfterSegment >= DISTANCE_XP_MILESTONES[milestoneIndex].distanceMeters
    ) {
      const milestone = DISTANCE_XP_MILESTONES[milestoneIndex];
      const fraction = (milestone.distanceMeters - distanceBeforeSegment) / segmentDistance;
      rewards.push({
        distanceMeters: milestone.distanceMeters,
        xpEarned: milestone.xpEarned,
        activityTimestampMs: before.timestampMs + (after.timestampMs - before.timestampMs) * fraction
      });
      milestoneIndex += 1;
    }

    distanceBeforeSegment = distanceAfterSegment;
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
  metadata: FitMetadata = {},
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
      type: passage.collectible.type,
      ...(passage.collectible.rarity === undefined ? {} : { rarity: passage.collectible.rarity })
    },
    value: passage.collectible.value,
    latitude: passage.collectible.latitude,
    longitude: passage.collectible.longitude,
    activityTimestamp: passage.timestampMs
  }));
  const fartlekCompletions = deriveFartlekCompletionDrafts(activity.route, fartleks);
  const distanceXpRewards = deriveDistanceXpRewards(activity.route);
  const distanceXp = distanceXpRewards.reduce((total, reward) => total + reward.xpEarned, 0);
  return {
    activityId: activity.id,
    distance: activity.distance,
    duration: activity.duration,
    collectedCount: events.length,
    totalPoints: events.reduce((total, event) => total + event.value, 0)
      + fartlekCompletions.length * FARTLEK_COMPLETION_XP
      + distanceXp,
    distanceXp,
    distanceXpRewards,
    collectibles,
    events,
    nearMisses: deriveNearMisses(activity, collectibles, events),
    fartlekCompletions
  };
};
