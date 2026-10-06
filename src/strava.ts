import type { ActivityType, TrackPoint } from "./domain.js";

export const STRAVA_SCOPES = ["read", "activity:read_all"] as const;

export const createStravaAuthorizationUrl = (
  clientId: string,
  redirectUri: string,
  state: string
): string => {
  const authorize = new URL("https://www.strava.com/oauth/authorize");
  authorize.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: STRAVA_SCOPES.join(","),
    state
  }).toString();
  return authorize.toString();
};

export class StravaApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "STRAVA_API_ERROR"
  ) {
    super(message);
    this.name = "StravaApiError";
  }
}

export interface StravaActivitySummary {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  distance: number;
  moving_time: number;
  total_elevation_gain: number;
}

export interface NormalizedStravaActivity {
  externalId: string;
  name: string;
  sportType: string;
  type: ActivityType;
  startedAt: string;
  distance: number;
  elevationGain: number;
  duration: number;
}

export const mapStravaSportType = (sportType: string): ActivityType | undefined => {
  if (["Ride", "GravelRide", "MountainBikeRide", "EBikeRide"].includes(sportType)) return "cycling";
  if (["Run", "TrailRun"].includes(sportType)) return "running";
  if (sportType === "Hike") return "hiking";
  if (sportType === "Walk") return "walking";
  return undefined;
};

export const normalizeStravaActivity = (
  activity: StravaActivitySummary
): NormalizedStravaActivity | undefined => {
  if (typeof activity.sport_type !== "string" || typeof activity.name !== "string" ||
      !Number.isFinite(activity.distance) || activity.distance < 0 ||
      !Number.isFinite(activity.moving_time) || activity.moving_time < 0 ||
      !Number.isFinite(activity.total_elevation_gain) || activity.total_elevation_gain < 0) {
    throw new Error("Strava returned invalid activity details.");
  }
  const type = mapStravaSportType(activity.sport_type);
  if (!type) return undefined;
  if (!Number.isSafeInteger(activity.id) || activity.id <= 0) {
    throw new Error("Strava returned an invalid activity id.");
  }
  const startedAt = new Date(activity.start_date);
  if (!Number.isFinite(startedAt.getTime())) throw new Error("Strava returned an invalid activity start time.");
  return {
    externalId: String(activity.id),
    name: activity.name,
    sportType: activity.sport_type,
    type,
    startedAt: startedAt.toISOString(),
    distance: activity.distance,
    elevationGain: activity.total_elevation_gain,
    duration: activity.moving_time
  };
};

export const grantedStravaScopes = (value: string): string[] =>
  value.split(/[,\s]+/).map((scope) => scope.trim()).filter(Boolean);

export const hasRequiredStravaScopes = (value: string): boolean => {
  const scopes = new Set(grantedStravaScopes(value));
  return STRAVA_SCOPES.every((scope) => scopes.has(scope));
};

export const normalizeStravaStreams = (
  startedAt: string,
  latitudeLongitude: unknown,
  elapsedSeconds: unknown
): TrackPoint[] => {
  if (!Array.isArray(latitudeLongitude) || !Array.isArray(elapsedSeconds) ||
      latitudeLongitude.length !== elapsedSeconds.length || latitudeLongitude.length < 2) {
    throw new Error("Strava did not provide a usable GPS track.");
  }
  const startMs = Date.parse(startedAt);
  if (!Number.isFinite(startMs)) throw new Error("Strava returned an invalid activity start time.");
  const points = latitudeLongitude.map((coordinate, index): TrackPoint => {
    if (!Array.isArray(coordinate) || coordinate.length < 2 ||
        typeof coordinate[0] !== "number" || typeof coordinate[1] !== "number" ||
        typeof elapsedSeconds[index] !== "number" || !Number.isFinite(elapsedSeconds[index]) ||
        elapsedSeconds[index] < 0) {
      throw new Error("Strava returned malformed GPS stream data.");
    }
    const [latitude, longitude] = coordinate;
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error("Strava returned invalid GPS coordinates.");
    }
    const timestampMs = startMs + elapsedSeconds[index] * 1000;
    if (!Number.isFinite(timestampMs)) throw new Error("Strava returned invalid GPS timestamps.");
    return { latitude, longitude, timestampMs };
  });
  if (points.some((point, index) => index > 0 && point.timestampMs < points[index - 1].timestampMs)) {
    throw new Error("Strava returned GPS points out of chronological order.");
  }
  return points;
};

export const stravaJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new StravaApiError(503, "Strava could not be reached. Try again shortly.");
  }
  if (!response.ok) {
    if (response.status === 429) {
      throw new StravaApiError(429, "Strava is receiving too many requests. Try again shortly.", "STRAVA_RATE_LIMITED");
    }
    if (response.status === 403) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new StravaApiError(403, "Strava denied access to this request.", "STRAVA_ACCESS_DENIED");
      }
      if (typeof payload === "object" && payload !== null && "errors" in payload &&
          Array.isArray(payload.errors) && payload.errors.some((error: unknown) =>
            typeof error === "object" && error !== null &&
            "resource" in error && error.resource === "Application" &&
            "field" in error && error.field === "Status" &&
            "code" in error && error.code === "Inactive")) {
        throw new StravaApiError(
          403,
          "Strava authorization succeeded, but the Strava developer application is inactive. Check its status in Strava API settings; reconnecting will not fix this.",
          "STRAVA_APPLICATION_INACTIVE"
        );
      }
      throw new StravaApiError(403, "Strava denied access to this request.", "STRAVA_ACCESS_DENIED");
    }
    throw new StravaApiError(response.status, "Strava could not complete the request. Reconnect if the problem continues.");
  }
  try {
    return await response.json() as T;
  } catch {
    throw new StravaApiError(502, "Strava returned an invalid response.");
  }
};
