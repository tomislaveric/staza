import { formatDuration } from "../format-duration.js";

export const SPORT_OPTIONS = [
  { value: "cycling", label: "Cycling" },
  { value: "running", label: "Running" },
  { value: "hiking", label: "Hiking" }
];

export const formatRouteDistance = (meters) => `${(meters / 1000).toFixed(meters >= 100_000 ? 0 : 1)} km`;

export const formatRouteDuration = formatDuration;

export const plannedRouteGpxUrl = (instanceId) => `/api/quest-instances/${encodeURIComponent(instanceId)}/planned-route.gpx`;

/** Short summary of a stored PlannedRoute for a running exploration card. */
export const plannedRouteSummary = (route) =>
  `${formatRouteDistance(route.distanceM)} · ${formatRouteDuration(route.durationS)}${
    route.routeType === "round_trip" ? " · Round trip" : " · A to B"}`;
