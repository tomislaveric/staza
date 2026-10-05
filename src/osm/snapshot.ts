import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import type { OSMRecord } from "./model.js";
import { isRetainedTagKey, matchesSourceClass } from "./selectors.js";

export const OSM_SNAPSHOT_VERSION = "osm-snapshot-v1";
export const DEFAULT_OSM_SNAPSHOT_FILE = "fixtures/osm-germany.json";

export interface OSMSnapshotMetadata {
  snapshotVersion: string;
  sourceUrl: string;
  sourceVersion: string;
  attribution: string;
  license: string;
  generatedAt: string;
  selectors: string[];
  coverageComplete: boolean;
  scanned: number;
  [key: string]: unknown;
}

export interface OSMSnapshot {
  metadata: OSMSnapshotMetadata;
  records: OSMRecord[];
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const readText = async (file: string): Promise<string> => {
  const stream: Readable = file.endsWith(".gz")
    ? createReadStream(file).pipe(createGunzip())
    : createReadStream(file, { encoding: "utf8" });
  const chunks: string[] = [];
  for await (const chunk of stream) chunks.push(chunk.toString("utf8"));
  return chunks.join("");
};

/**
 * Reads a committed OSM extract snapshot. Its records are normalized by the
 * regular pipeline; the importer performs no live OSM requests.
 */
export const readOSMSnapshot = async (file: string): Promise<OSMSnapshot> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readText(file));
  } catch (error) {
    throw new Error(`Invalid OSM snapshot JSON (${file}): ${
      error instanceof Error ? error.message : String(error)}`);
  }
  const document = asRecord(parsed);
  const metadata = asRecord(document?.metadata);
  if (!document || !metadata || !Array.isArray(document.records)) {
    throw new Error(`OSM snapshot must contain a metadata object and a records array: ${file}`);
  }
  if (metadata.snapshotVersion !== OSM_SNAPSHOT_VERSION) {
    throw new Error(
      `Unsupported OSM snapshot version ${String(metadata.snapshotVersion)}; expected ${OSM_SNAPSHOT_VERSION}.`);
  }
  if (typeof metadata.sourceUrl !== "string" || !metadata.sourceUrl.trim()) {
    throw new Error(`OSM snapshot metadata requires a sourceUrl: ${file}`);
  }
  return {
    metadata: { coverageComplete: true, ...metadata } as unknown as OSMSnapshotMetadata,
    records: document.records as OSMRecord[]
  };
};

const bboxCenter = (coordinates: unknown): { latitude: number; longitude: number } | undefined => {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      const [longitude, latitude] = value as [number, number];
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
      west = Math.min(west, longitude);
      east = Math.max(east, longitude);
      south = Math.min(south, latitude);
      north = Math.max(north, latitude);
      return;
    }
    for (const item of value) visit(item);
  };
  visit(coordinates);
  if (!Number.isFinite(west) || !Number.isFinite(south)) return undefined;
  return { latitude: (south + north) / 2, longitude: (west + east) / 2 };
};

const osmTypeFrom = (value: string): OSMRecord["osmType"] | undefined => {
  if (value.startsWith("node/") || value.startsWith("n")) return "node";
  if (value.startsWith("way/") || value.startsWith("w")) return "way";
  if (value.startsWith("relation/") || value.startsWith("r")) return "relation";
  return undefined;
};

const osmIdFrom = (value: string): string | undefined => {
  const digits = value.replace(/^[a-z]+\/?/, "");
  return /^\d+$/.test(digits) ? digits : undefined;
};

/**
 * Converts one `osmium export` GeoJSON feature (ids added with
 * `--add-unique-id=type_id`) into an OSM record. Non-point geometries collapse
 * to their bounding-box center.
 */
export const recordFromExportFeature = (value: unknown): OSMRecord | undefined => {
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
  const center = geometry.type === "Point"
    ? bboxCenter([geometry.coordinates])
    : bboxCenter(geometry.coordinates);
  if (!center) return undefined;
  const all: Record<string, string> = {};
  for (const [key, tagValue] of Object.entries(properties)) {
    if (key.startsWith("@")) continue;
    if (typeof tagValue === "string") all[key] = tagValue;
    else if (typeof tagValue === "number" || typeof tagValue === "boolean") all[key] = String(tagValue);
  }
  if (!matchesSourceClass(all)) return undefined;
  const tags = Object.fromEntries(Object.entries(all).filter(([key]) => isRetainedTagKey(key)));
  if (Object.keys(tags).length === 0) return undefined;
  return { osmType, osmId, latitude: center.latitude, longitude: center.longitude, tags };
};

/** Streams `osmium export -f geojsonseq` output into deduplicated OSM records. */
export const recordsFromExportStream = async (
  input: Readable
): Promise<{ records: OSMRecord[]; scanned: number; skipped: number }> => {
  const byIdentity = new Map<string, OSMRecord>();
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
    const record = recordFromExportFeature(parsed);
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
