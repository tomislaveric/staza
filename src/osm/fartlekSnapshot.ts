import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import type { OSMWayRecord } from "./fartlekModel.js";

// v2: newline-delimited JSON (one metadata line, then one record per line) instead of a single
// JSON document. A country-scale way-geometry extract can be several hundred MB to multiple GB —
// too large to materialize as one JS string/JSON.parse call (hits V8's max string length and/or
// exhausts the heap). NDJSON lets both the writer (buildFartlekSnapshot.ts) and this reader
// stream line-by-line without ever holding the raw text as a single string.
export const FARTLEK_OSM_SNAPSHOT_VERSION = "fartlek-osm-snapshot-v2";
export const DEFAULT_FARTLEK_OSM_SNAPSHOT_FILE = "fixtures/osm-germany-fartleks.ndjson";

export interface FartlekOSMSnapshotMetadata {
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

export interface FartlekOSMSnapshot {
  metadata: FartlekOSMSnapshotMetadata;
  records: OSMWayRecord[];
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const openLines = (file: string): ReturnType<typeof createInterface> => {
  const stream: Readable = file.endsWith(".gz")
    ? createReadStream(file).pipe(createGunzip())
    : createReadStream(file);
  return createInterface({ input: stream, crlfDelay: Infinity });
};

/**
 * Reads a committed Fartlek OSM way-geometry extract snapshot. No live OSM requests are made —
 * mirrors the offline Geofabrik/osmium snapshot convention used for point collectibles
 * (`src/osm/snapshot.ts`), but for full `LineString` way geometry, stored as NDJSON (see above).
 */
export const readFartlekOSMSnapshot = async (file: string): Promise<FartlekOSMSnapshot> => {
  const lines = openLines(file);
  let metadata: Record<string, unknown> | undefined;
  const records: OSMWayRecord[] = [];
  let lineNumber = 0;
  for await (const rawLine of lines) {
    const line = rawLine.trim();
    lineNumber += 1;
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid Fartlek OSM snapshot JSON on line ${lineNumber} (${file}): ${
        error instanceof Error ? error.message : String(error)}`);
    }
    if (lineNumber === 1) {
      const document = asRecord(parsed);
      metadata = asRecord(document?.metadata);
      if (!document || !metadata) {
        throw new Error(`Fartlek OSM snapshot's first line must be a {"metadata": {...}} object: ${file}`);
      }
      continue;
    }
    records.push(parsed as OSMWayRecord);
  }
  if (!metadata) {
    throw new Error(`Fartlek OSM snapshot must contain a metadata object and a records array: ${file}`);
  }
  if (metadata.snapshotVersion !== FARTLEK_OSM_SNAPSHOT_VERSION) {
    throw new Error(
      `Unsupported Fartlek OSM snapshot version ${String(metadata.snapshotVersion)}; ` +
      `expected ${FARTLEK_OSM_SNAPSHOT_VERSION}.`);
  }
  if (typeof metadata.sourceUrl !== "string" || !metadata.sourceUrl.trim()) {
    throw new Error(`Fartlek OSM snapshot metadata requires a sourceUrl: ${file}`);
  }
  return {
    metadata: { coverageComplete: true, ...metadata } as unknown as FartlekOSMSnapshotMetadata,
    records
  };
};
