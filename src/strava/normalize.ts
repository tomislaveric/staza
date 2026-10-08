import { deriveActivity } from "../activity.js";
import type { Activity, ActivityType, TrackPoint } from "../domain.js";
import { StravaError } from "./errors.js";
import type { StravaActivitySummary, StravaStreams } from "./client.js";

const sportTypes: Record<string, ActivityType> = {
  Ride: "cycling",
  GravelRide: "cycling",
  MountainBikeRide: "cycling",
  EBikeRide: "cycling",
  EMountainBikeRide: "cycling",
  VirtualRide: "cycling",
  Velomobile: "cycling",
  Handcycle: "cycling",
  Run: "running",
  TrailRun: "running",
  VirtualRun: "running",
  Hike: "hiking",
  Walk: "walking"
};

/** Maps Strava's sport_type (falling back to the legacy type) onto Staza's ActivityType set. */
export const mapStravaSportType = (sportType: string | undefined, legacyType?: string): ActivityType =>
  sportTypes[sportType ?? ""] ?? sportTypes[legacyType ?? ""] ?? "unknown";

const validCoordinate = (latitude: unknown, longitude: unknown): latitude is number =>
  typeof latitude === "number" && typeof longitude === "number"
  && Number.isFinite(latitude) && Number.isFinite(longitude)
  && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
  && !(latitude === 0 && longitude === 0);

/**
 * Converts Strava `latlng` + `time` streams into canonical absolute-UTC TrackPoints. Invalid
 * coordinates are dropped and timestamps must strictly increase.
 */
export const normalizeStravaTrack = (startDate: string | undefined, streams: StravaStreams): TrackPoint[] => {
  const startMs = typeof startDate === "string" ? Date.parse(startDate) : Number.NaN;
  const latlng = streams.latlng?.data;
  const time = streams.time?.data;
  if (!Number.isFinite(startMs) || !Array.isArray(latlng) || !Array.isArray(time)) throw new StravaError("invalid_streams");
  const points: TrackPoint[] = [];
  const length = Math.min(latlng.length, time.length);
  for (let index = 0; index < length; index += 1) {
    const coordinate = latlng[index];
    const offset = time[index];
    if (!Array.isArray(coordinate) || typeof offset !== "number" || !Number.isFinite(offset) || offset < 0) continue;
    const [latitude, longitude] = coordinate;
    if (!validCoordinate(latitude, longitude)) continue;
    const timestampMs = startMs + offset * 1000;
    if (points.length > 0 && timestampMs <= points.at(-1)!.timestampMs) continue;
    points.push({ latitude, longitude: longitude as number, timestampMs });
  }
  if (points.length < 2) throw new StravaError("invalid_streams");
  return points;
};

export const normalizeStravaActivity = (
  id: string,
  summary: StravaActivitySummary,
  streams: StravaStreams
): Activity => {
  const route = normalizeStravaTrack(summary.start_date, streams);
  const title = typeof summary.name === "string" && summary.name.trim() ? summary.name.trim().slice(0, 200) : undefined;
  return deriveActivity(
    id,
    route,
    mapStravaSportType(summary.sport_type, summary.type),
    title === undefined ? {} : { title },
    "strava"
  );
};
