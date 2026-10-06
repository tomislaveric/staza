import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import type { Readable } from "node:stream";
import type { OSMWayRecord } from "./fartlekModel.js";

export const FARTLEK_OSM_SNAPSHOT_VERSION = "fartlek-osm-snapshot-v1";
export const DEFAULT_FARTLEK_OSM_SNAPSHOT_FILE = "fixtures/osm-germany-fartleks.json";

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

const readText = async (file: string): Promise<string> => {
  const stream: Readable = file.endsWith(".gz")
    ? createReadStream(file).pipe(createGunzip())
    : createReadStream(file, { encoding: "utf8" });
  const chunks: string[] = [];
  for await (const chunk of stream) chunks.push(chunk.toString("utf8"));
  return chunks.join("");
};

/**
 * Reads a committed Fartlek OSM way-geometry extract snapshot. No live OSM requests are made —
 * mirrors the offline Geofabrik/osmium snapshot convention used for point collectibles
 * (`src/osm/snapshot.ts`), but for full `LineString` way geometry.
 */
export const readFartlekOSMSnapshot = async (file: string): Promise<FartlekOSMSnapshot> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readText(file));
  } catch (error) {
    throw new Error(`Invalid Fartlek OSM snapshot JSON (${file}): ${
      error instanceof Error ? error.message : String(error)}`);
  }
  const document = asRecord(parsed);
  const metadata = asRecord(document?.metadata);
  if (!document || !metadata || !Array.isArray(document.records)) {
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
    records: document.records as OSMWayRecord[]
  };
};
