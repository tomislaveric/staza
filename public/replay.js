const FEEDBACK_DURATION_MS = 1_500;

const replayDurationSeconds = (duration) => Math.min(30, Math.max(12, duration / 120));

const replayCollectibles = (activityResult) => activityResult.collectibles;

const interpolatePosition = (route, timestampMs) => {
  const afterIndex = route.findIndex((point) => point.timestampMs >= timestampMs);
  if (afterIndex <= 0) return route[0];
  if (afterIndex === -1) return route.at(-1);
  const before = route[afterIndex - 1];
  const after = route[afterIndex];
  const fraction = (timestampMs - before.timestampMs) / (after.timestampMs - before.timestampMs || 1);
  return {
    latitude: before.latitude + (after.latitude - before.latitude) * fraction,
    longitude: before.longitude + (after.longitude - before.longitude) * fraction,
    timestampMs
  };
};

export const collectiblePresentation = (collectible) => ({
  typeClass: collectible.type === "landmark" ? "collectible-landmark" : "collectible-coin",
  typeLabel: collectible.type === "landmark" ? "Landmark" : "Coin"
});

export const eventAtTimestamp = (events, timestampMs) =>
  events.filter((event) => event.activityTimestamp <= timestampMs).sort(
    (left, right) => left.activityTimestamp - right.activityTimestamp
  );

export const activeCollectionFeedback = (events, timestampMs) =>
  [...events].reverse().find(
    (event) => timestampMs >= event.activityTimestamp && timestampMs < event.activityTimestamp + FEEDBACK_DURATION_MS
  );

export const markerState = (sourceId, events, timestampMs) => {
  const event = events.find((candidate) => candidate.sourceId === sourceId);
  if (!event || timestampMs < event.activityTimestamp) return "available";
  return timestampMs < event.activityTimestamp + FEEDBACK_DURATION_MS ? "collecting" : "collected";
};

export const replayScore = (events, timestampMs) =>
  eventAtTimestamp(events, timestampMs).reduce((total, event) => total + event.value, 0);

export const feedDisplayData = (events, timestampMs) =>
  eventAtTimestamp(events, timestampMs).reverse().map((event) => ({
    event,
    name: event.collectible?.name || event.sourceId,
    value: event.value
  }));

const distanceMeters = (left, right) => {
  const radians = Math.PI / 180;
  const latitudeDelta = (right.latitude - left.latitude) * radians;
  const longitudeDelta = (right.longitude - left.longitude) * radians;
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(left.latitude * radians) * Math.cos(right.latitude * radians) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * 6_371_000 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const nextCollectibleData = (collectibles, events, timestampMs, rider) => {
  const collectibleIds = new Set(collectibles.map((collectible) => collectible.id));
  const event = events
    .filter((candidate) => collectibleIds.has(candidate.sourceId) && candidate.activityTimestamp > timestampMs)
    .sort((left, right) => left.activityTimestamp - right.activityTimestamp)[0];
  if (!event) return undefined;
  return {
    event,
    name: event.collectible?.name || event.sourceId,
    distanceMeters: distanceMeters(rider, event)
  };
};

export const replayCompletion = (elapsedSeconds, durationSeconds, collectedCount, totalPoints) =>
  elapsedSeconds >= durationSeconds
    ? { collectedCount, totalPoints }
    : undefined;

export const nearMissDisplayData = (nearMisses) =>
  nearMisses.length === 0
    ? undefined
    : nearMisses.map((nearMiss) => ({
      ...nearMiss,
      distanceLabel: `${Math.round(nearMiss.minimumDistanceMeters)} m away`
    }));

export const replayMarkers = (activityResult) => {
  const sources = activityResult.collectibles.map((collectible) => ({ ...collectible, event: undefined }));
  const knownIds = new Set(sources.map((collectible) => collectible.id));
  for (const event of activityResult.events) {
    if (!knownIds.has(event.sourceId)) {
      sources.push({
        id: event.sourceId,
        name: event.collectible?.name || event.sourceId,
        type: event.collectible?.type || "coin",
        latitude: event.latitude,
        longitude: event.longitude,
        event
      });
    }
  }
  return sources;
};

export {
  interpolatePosition,
  replayCollectibles,
  replayDurationSeconds
};
