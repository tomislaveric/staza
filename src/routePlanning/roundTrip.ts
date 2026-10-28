import { distanceBetween } from "./geo.js";
import type { LatLon, RoutingResult } from "./types.js";

/**
 * Makes a round-trip route visibly end where it started. Routers snap the start to the road
 * network, so the geometry may stop short of the start; a closing leg is appended and its
 * length (at the route's own average pace) is added to distance and duration.
 */
export const closeRoundTrip = (result: RoutingResult, start: LatLon): RoutingResult => {
  const coordinates = result.geometry.coordinates;
  const [lastLon, lastLat] = coordinates[coordinates.length - 1];
  if (lastLon === start.lon && lastLat === start.lat) return result;
  const gapM = distanceBetween({ lat: lastLat, lon: lastLon }, start);
  const paceSPerM = result.distanceM > 0 ? result.durationS / result.distanceM : 0;
  return {
    ...result,
    distanceM: result.distanceM + gapM,
    durationS: result.durationS + gapM * paceSPerM,
    geometry: { type: "LineString", coordinates: [...coordinates, [start.lon, start.lat]] }
  };
};
