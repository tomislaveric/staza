import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import type { OSMWayRecord } from "./fartlekModel.js";
import {
  isRetainedFartlekNodeTagKey,
  isRetainedFartlekWayTagKey,
  matchesFartlekBoundaryNode,
  matchesFartlekControlNode,
  matchesFartlekWayClass
} from "./fartlekSelectors.js";

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const osmTypeFrom = (value: string): "way" | "node" | undefined => {
  if (value.startsWith("node/") || value.startsWith("n")) return "node";
  if (value.startsWith("way/") || value.startsWith("w")) return "way";
  return undefined;
};

const osmIdFrom = (value: string): string | undefined => {
  const digits = value.replace(/^[a-z]+\/?/, "");
  return /^\d+$/.test(digits) ? digits : undefined;
};

const tagsFrom = (properties: Record<string, unknown>): Record<string, string> => {
  const all: Record<string, string> = {};
  for (const [key, tagValue] of Object.entries(properties)) {
    if (key.startsWith("@")) continue;
    if (typeof tagValue === "string") all[key] = tagValue;
    else if (typeof tagValue === "number" || typeof tagValue === "boolean") all[key] = String(tagValue);
  }
  return all;
};

const lineStringCoordinates = (geometry: Record<string, unknown>): [number, number][] | undefined => {
  if (geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) return undefined;
  const coordinates: [number, number][] = [];
  for (const point of geometry.coordinates) {
    if (!Array.isArray(point) || point.length < 2) return undefined;
    const [longitude, latitude] = point;
    if (typeof longitude !== "number" || typeof latitude !== "number") return undefined;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return undefined;
    coordinates.push([longitude, latitude]);
  }
  return coordinates.length >= 2 ? coordinates : undefined;
};

const pointCoordinate = (geometry: Record<string, unknown>): [number, number] | undefined => {
  if (geometry.type !== "Point" || !Array.isArray(geometry.coordinates)) return undefined;
  const [longitude, latitude] = geometry.coordinates;
  if (typeof longitude !== "number" || typeof latitude !== "number") return undefined;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return undefined;
  return [longitude, latitude];
};

/**
 * Converts one `osmium export` GeoJSON feature (ids added with `--add-unique-id=type_id`) into a
 * way-geometry-preserving Fartlek record. Unlike `snapshot.ts`'s `recordFromExportFeature`, this
 * keeps the full coordinate array for `highway` ways instead of collapsing to a centroid, and also
 * accepts single-point boundary/traffic-control nodes (`traffic_sign=city_limit`,
 * `highway=traffic_signals`, etc.) as length-1 coordinate arrays.
 */
export const fartlekRecordFromExportFeature = (value: unknown): OSMWayRecord | undefined => {
  const feature = asRecord(value);
  const geometry = asRecord(feature?.geometry);
  const properties = asRecord(feature?.properties);
  const identity = typeof feature?.id === "string"
    ? feature.id
    : typeof asRecord(feature?.properties)?.["@id"] === "string"
      ? String(asRecord(feature?.properties)?.["@id"])
      : undefined;
  if (!geometry || !properties || !identity) return undefined;
  const osmType = osmTypeFrom(identity);
  const osmId = osmIdFrom(identity);
  if (!osmType || !osmId) return undefined;
  const all = tagsFrom(properties);

  if (osmType === "way") {
    if (!matchesFartlekWayClass(all)) return undefined;
    const coordinates = lineStringCoordinates(geometry);
    if (!coordinates) return undefined;
    const tags = Object.fromEntries(Object.entries(all).filter(([key]) => isRetainedFartlekWayTagKey(key)));
    return { osmType, osmId, coordinates, tags };
  }

  if (!matchesFartlekBoundaryNode(all) && !matchesFartlekControlNode(all)) return undefined;
  const point = pointCoordinate(geometry);
  if (!point) return undefined;
  const tags = Object.fromEntries(Object.entries(all).filter(([key]) => isRetainedFartlekNodeTagKey(key)));
  return { osmType, osmId, coordinates: [point], tags };
};

/** Streams `osmium export -f geojsonseq` output into deduplicated Fartlek way/node records. */
export const fartlekRecordsFromExportStream = async (
  input: Readable
): Promise<{ records: OSMWayRecord[]; scanned: number; skipped: number }> => {
  const byIdentity = new Map<string, OSMWayRecord>();
  let scanned = 0;
  let skipped = 0;
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const rawLine of lines) {
    // geojsonseq lines may be prefixed with the RS control character.
    const line = rawLine.replace(/^\u001e/, "").trim();
    if (!line) continue;
    scanned += 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }
    const record = fartlekRecordFromExportFeature(parsed);
    if (!record) {
      skipped += 1;
      continue;
    }
    byIdentity.set(`${record.osmType}:${record.osmId}`, record);
  }
  return {
    records: [...byIdentity.values()].sort((left, right) =>
      `${left.osmType}:${left.osmId}`.localeCompare(`${right.osmType}:${right.osmId}`)),
    scanned,
    skipped
  };
};
