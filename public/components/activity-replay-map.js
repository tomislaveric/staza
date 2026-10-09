import { createStazaMap } from "./shared/map/staza-map.js";
import { stazaRouteLayers, stazaSubduedRouteLayers } from "./shared/map/staza-route-layers.js";
import { ensureFartlekLayers, fartleksToFeatureCollection, setFartlekData } from "./shared/map/staza-fartlek-layers.js";
import {
  ensureCollectibleLayers,
  setCollectibleData
} from "./shared/map/staza-collectible-layers.js";
import { collectiblesToFeatureCollection } from "./shared/map/staza-collectible-features.js";
import { lineFeature, pointFeature, pointsToBounds } from "./shared/map/staza-map-utils.js";
import { interpolatePosition, markerState, replayDurationSeconds, replayMarkers } from "../replay.js";

const ROUTE_BACKGROUND_SOURCE = "staza-activity-route-background";
const ROUTE_PROGRESS_SOURCE = "staza-activity-route";
const POSITION_SOURCE = "staza-activity-position";

const POSITION_HALO_LAYER = "staza-activity-position-halo";
const POSITION_LAYER = "staza-activity-position";

/** The travelled activity route reads clearly in a Staza accent, distinct from the quest gold. */
const ACTIVITY_ROUTE_ACCENT = "#5ec8c2";
const POSITION_ACCENT = "#e8b80a";
const FIT_PADDING = 48;

/** Absolute activity timestamp for a 0..1 playback progress. */
export const replayTimestamp = (activity, progress) =>
  activity.startedAt + (activity.endedAt - activity.startedAt) * Math.max(0, Math.min(1, progress));

/**
 * The travelled portion of the route as a `[longitude, latitude]` list, with the current
 * interpolated position appended so the progress line always reaches the rider.
 */
export const traveledCoordinates = (route, timestampMs) => {
  const coordinates = route
    .filter((point) => point.timestampMs <= timestampMs)
    .map((point) => [point.longitude, point.latitude]);
  const head = interpolatePosition(route, timestampMs);
  if (head) coordinates.push([head.longitude, head.latitude]);
  return coordinates;
};

/**
 * Decorates each replay source with presentation-only activity collection state derived from
 * the historical events, so the shared collectible layers can transition pending -> collected
 * without touching any domain state.
 */
export const activityCollectibleSources = (sources, events, timestampMs) =>
  sources.map((source) => {
    const collected = markerState(source.id, events, timestampMs) === "collected";
    return { ...source, found: false, activityCollected: collected, activityPending: !collected };
  });

/** Completed flowlines are revealed at their collection timestamp, in the shared gold state. */
export const activityFlowlineSources = (completions = [], timestampMs) =>
  completions
    .filter((completion) =>
      completion.fartlekGeometry && completion.completedAtTimestampMs <= timestampMs)
    .map((completion) => ({
      id: completion.fartlekId,
      name: completion.fartlekName,
      geometry: completion.fartlekGeometry,
      completed: true
    }));

/**
 * Absolute activity timestamp past the end of playback, so every historical collection event
 * has resolved. Used to render the settled "result of the replay" for a static thumbnail.
 */
const settledTimestamp = (activity) => activity.endedAt + 10_000;

/**
 * Mounts a static, non-interactive Staza map showing the completed activity: the full route
 * in the Staza accent with every collected collectible in its settled state. It reuses the
 * exact same basemap, theme and collectible vocabulary as the World and replay maps, so a
 * Rides list thumbnail reads as the same world. No animation, controls or interaction.
 */
export const mountReplayStill = async ({ container, activity, activityResult, basemap }) => {
  const { route } = activity;
  const sources = replayMarkers(activityResult);
  const routeCoordinates = route.map((point) => [point.longitude, point.latitude]);

  const staza = await createStazaMap(container, {
    styleUrl: basemap?.styleUrl,
    attribution: basemap?.attribution,
    navigation: false,
    interactive: false
  });
  const { map } = staza;
  await staza.ready;

  map.addSource(ROUTE_BACKGROUND_SOURCE, { type: "geojson", data: lineFeature(routeCoordinates) });
  for (const layer of stazaSubduedRouteLayers(ROUTE_BACKGROUND_SOURCE)) map.addLayer(layer);

  map.addSource(ROUTE_PROGRESS_SOURCE, { type: "geojson", data: lineFeature(routeCoordinates) });
  for (const layer of stazaRouteLayers(ROUTE_PROGRESS_SOURCE, { accent: ACTIVITY_ROUTE_ACCENT })) {
    map.addLayer(layer);
  }

  ensureFartlekLayers(map);
  ensureCollectibleLayers(map);
  setCollectibleData(
    map,
    collectiblesToFeatureCollection(
      activityCollectibleSources(sources, activityResult.events, settledTimestamp(activity))
    )
  );
  setFartlekData(
    map,
    fartleksToFeatureCollection(activityFlowlineSources(
      activityResult.fartlekCompletions,
      settledTimestamp(activity)
    ))
  );

  const bounds = pointsToBounds([...route, ...sources]);
  if (bounds) map.fitBounds(bounds, { padding: 18, maxZoom: 15, duration: 0 });

  return { destroy: () => staza.destroy() };
};

const positionLayers = () => [
  {
    id: POSITION_HALO_LAYER,
    type: "circle",
    source: POSITION_SOURCE,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 9, 15, 16],
      "circle-color": POSITION_ACCENT,
      "circle-opacity": 0.18
    }
  },
  {
    id: POSITION_LAYER,
    type: "circle",
    source: POSITION_SOURCE,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 4, 15, 7],
      "circle-color": "#f5f7fa",
      "circle-stroke-width": 2,
      "circle-stroke-color": POSITION_ACCENT
    }
  }
];

/**
 * Mounts the Activity Detail replay on the shared Staza MapLibre foundation. The replay
 * engine in replay.js remains the source of truth for timing, duration and collection
 * semantics; this module only renders its state as native MapLibre layers:
 *
 *   basemap -> full route (subdued) -> travelled route -> collectibles -> position marker
 *
 * Returns the same play/pause/restart control surface as the previous canvas replay, plus a
 * destroy hook, so the tab wiring stays unchanged.
 */
export const mountReplayMap = async ({
  container,
  activity,
  activityResult,
  basemap,
  onPlaybackStateChange = () => {},
  onProgress = () => {},
  onReplayStart = () => {},
  onReplayComplete = () => {},
  onReady = () => {}
}) => {
  const { route } = activity;
  const duration = replayDurationSeconds(
    activityResult.duration ?? (activity.endedAt - activity.startedAt) / 1000
  );
  const sources = replayMarkers(activityResult);
  const routeCoordinates = route.map((point) => [point.longitude, point.latitude]);

  const staza = await createStazaMap(container, {
    styleUrl: basemap?.styleUrl,
    attribution: basemap?.attribution
  });
  const { map } = staza;
  await staza.ready;

  map.addSource(ROUTE_BACKGROUND_SOURCE, { type: "geojson", data: lineFeature(routeCoordinates) });
  for (const layer of stazaSubduedRouteLayers(ROUTE_BACKGROUND_SOURCE)) map.addLayer(layer);

  map.addSource(ROUTE_PROGRESS_SOURCE, { type: "geojson", data: lineFeature([]) });
  for (const layer of stazaRouteLayers(ROUTE_PROGRESS_SOURCE, { accent: ACTIVITY_ROUTE_ACCENT })) {
    map.addLayer(layer);
  }

  ensureFartlekLayers(map);
  ensureCollectibleLayers(map);

  map.addSource(POSITION_SOURCE, { type: "geojson", data: pointFeature() });
  for (const layer of positionLayers()) map.addLayer(layer);

  const bounds = pointsToBounds([...route, ...sources]);
  const fitRoute = (padding = FIT_PADDING, { duration = 0 } = {}) => {
    if (bounds) map.fitBounds(bounds, { padding, maxZoom: 15, duration });
  };
  fitRoute();

  const render = (progress) => {
    const timestamp = replayTimestamp(activity, progress);
    map.getSource(ROUTE_PROGRESS_SOURCE)?.setData(lineFeature(traveledCoordinates(route, timestamp)));
    const rider = interpolatePosition(route, timestamp);
    map.getSource(POSITION_SOURCE)?.setData(
      pointFeature(rider ? [rider.longitude, rider.latitude] : undefined)
    );
    setCollectibleData(
      map,
      collectiblesToFeatureCollection(activityCollectibleSources(sources, activityResult.events, timestamp))
    );
    setFartlekData(
      map,
      fartleksToFeatureCollection(activityFlowlineSources(
        activityResult.fartlekCompletions,
        timestamp
      ))
    );
    onProgress(timestamp, progress);
  };

  let startedAt;
  let elapsed = 0;
  let frame;
  let replayStarted = false;

  const play = (now) => {
    if (startedAt === undefined) startedAt = now - elapsed * 1000;
    elapsed = Math.min(duration, (now - startedAt) / 1000);
    render(elapsed / duration);
    if (elapsed < duration) frame = requestAnimationFrame(play);
    else {
      frame = undefined;
      onPlaybackStateChange(false);
      onReplayComplete();
    }
  };

  const pause = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    startedAt = undefined;
    onPlaybackStateChange(false);
  };

  render(0);
  onReady();

  return {
    play: () => {
      if (frame !== undefined) return;
      const replayEnded = elapsed >= duration;
      if (replayEnded) {
        elapsed = 0;
        startedAt = undefined;
        replayStarted = false;
      }
      if (!replayStarted) {
        replayStarted = true;
        onReplayStart();
      }
      if (replayEnded) render(0);
      onPlaybackStateChange(true);
      frame = requestAnimationFrame(play);
    },
    pause,
    restart: () => {
      pause();
      elapsed = 0;
      replayStarted = false;
      onReplayStart();
      replayStarted = true;
      render(0);
    },
    fitRoute,
    destroy: () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      staza.destroy();
    }
  };
};
