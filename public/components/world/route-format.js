import { formatDuration } from "../format-duration.js";

export const SPORT_OPTIONS = [
  { value: "cycling", label: "Cycling" },
  { value: "running", label: "Running" },
  { value: "hiking", label: "Hiking" }
];

export const formatRouteDistance = (meters) => `${(meters / 1000).toFixed(meters >= 100_000 ? 0 : 1)} km`;

export const formatRouteDuration = formatDuration;

/** A ridden Flowline's length, as shown with its completion. */
export const formatDistance = (meters) => `${(meters / 1000).toFixed(meters >= 10_000 ? 0 : 1)} km`;

/** mm:ss under an hour, h:mm:ss beyond. Matches the plain, non-arcade Staza tone. */
export const formatElapsed = (seconds) => {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const secs = total % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
};

export const formatSpeed = (metersPerSecond) => `${(metersPerSecond * 3.6).toFixed(1)} km/h`;

export const plannedRouteGpxUrl = (instanceId) => `/api/quest-instances/${encodeURIComponent(instanceId)}/planned-route.gpx`;

/** Short summary of a stored PlannedRoute for a running exploration card. */
export const plannedRouteSummary = (route) =>
  `${formatRouteDistance(route.distanceM)} · ${formatRouteDuration(route.durationS)}${
    route.routeType === "round_trip" ? " · Round trip" : " · A to B"}`;
