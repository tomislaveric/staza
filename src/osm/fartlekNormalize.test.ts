import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fartlekRecordFromExportFeature, fartlekRecordsFromExportStream } from "./fartlekNormalize.js";

const feature = (
  id: string,
  geometry: Record<string, unknown>,
  properties: Record<string, unknown>
): string => JSON.stringify({ type: "Feature", id, geometry, properties });

describe("Fartlek OSM export conversion", () => {
  it("preserves full LineString geometry and retained tags for a selected highway way", () => {
    const record = fartlekRecordFromExportFeature(JSON.parse(feature(
      "w2002",
      { type: "LineString", coordinates: [[11.5, 48.1], [11.6, 48.2]] },
      { highway: "secondary", ref: "B1", name: "Bundesstraße 1", amenity: "bench", "source:date": "2020" }
    )));
    expect(record).toEqual({
      osmType: "way",
      osmId: "2002",
      coordinates: [[11.5, 48.1], [11.6, 48.2]],
      tags: { highway: "secondary", ref: "B1", name: "Bundesstraße 1" }
    });
  });

  it("drops ways with an unselected highway class", () => {
    expect(fartlekRecordFromExportFeature(JSON.parse(feature(
      "w3003",
      { type: "LineString", coordinates: [[11, 48], [12, 49]] },
      { highway: "motorway" }
    )))).toBeUndefined();
  });

  it("drops residential and cycleway ways at bulk-extraction time (too voluminous country-wide)", () => {
    expect(fartlekRecordFromExportFeature(JSON.parse(feature(
      "w3004",
      { type: "LineString", coordinates: [[11, 48], [12, 49]] },
      { highway: "residential" }
    )))).toBeUndefined();
    expect(fartlekRecordFromExportFeature(JSON.parse(feature(
      "w3005",
      { type: "LineString", coordinates: [[11, 48], [12, 49]] },
      { highway: "cycleway" }
    )))).toBeUndefined();
  });

  it("keeps boundary and traffic-control nodes as single-point records", () => {
    const boundary = fartlekRecordFromExportFeature(JSON.parse(feature(
      "n1001",
      { type: "Point", coordinates: [11.5, 48.1] },
      { traffic_sign: "city_limit", name: "Ortseingang" }
    )));
    expect(boundary).toEqual({
      osmType: "node",
      osmId: "1001",
      coordinates: [[11.5, 48.1]],
      tags: { traffic_sign: "city_limit", name: "Ortseingang" }
    });

    const control = fartlekRecordFromExportFeature(JSON.parse(feature(
      "n1002",
      { type: "Point", coordinates: [11.6, 48.2] },
      { highway: "traffic_signals" }
    )));
    expect(control).toMatchObject({ osmType: "node", osmId: "1002", coordinates: [[11.6, 48.2]] });
  });

  it("drops nodes that are neither boundary nor control markers", () => {
    expect(fartlekRecordFromExportFeature(JSON.parse(feature(
      "n4004",
      { type: "Point", coordinates: [11, 48] },
      { amenity: "bench" }
    )))).toBeUndefined();
  });

  it("streams geojsonseq lines into deduplicated sorted records", async () => {
    const lines = [
      `\u001e${feature("w1", { type: "LineString", coordinates: [[11, 48], [12, 49]] }, { highway: "secondary" })}`,
      feature("w1", { type: "LineString", coordinates: [[11, 48], [12, 49]] }, { highway: "secondary" }),
      feature("n2", { type: "Point", coordinates: [12, 49] }, { highway: "stop" }),
      "not json",
      ""
    ].join("\n");

    const parsed = await fartlekRecordsFromExportStream(Readable.from([lines]));

    expect(parsed.records).toHaveLength(2);
    expect(parsed.records.map((record) => `${record.osmType}:${record.osmId}`)).toEqual(["node:2", "way:1"]);
    expect(parsed.scanned).toBe(4);
    expect(parsed.skipped).toBe(1);
  });
});

describe("Fartlek OSM snapshot round-trip", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })));
  });

  it("writes and reads back records with metadata defaults applied", async () => {
    const { readFartlekOSMSnapshot, FARTLEK_OSM_SNAPSHOT_VERSION } = await import("./fartlekSnapshot.js");
    const directory = await mkdtemp(path.join(os.tmpdir(), "staza-fartlek-snapshot-"));
    temporaryDirectories.push(directory);
    const file = path.join(directory, "osm-germany-fartleks.ndjson");
    const lines = [
      JSON.stringify({
        metadata: {
          snapshotVersion: FARTLEK_OSM_SNAPSHOT_VERSION,
          sourceUrl: "https://download.geofabrik.de/europe/germany-latest.osm.pbf",
          sourceVersion: "geofabrik-germany-2026-10-05",
          generatedAt: "2026-10-05T18:00:00.000Z",
          selectors: ["highway=secondary"],
          scanned: 1
        }
      }),
      JSON.stringify({ osmType: "way", osmId: "1", coordinates: [[11, 48], [12, 49]], tags: { highway: "secondary" } })
    ];
    await writeFile(file, `${lines.join("\n")}\n`, "utf8");

    const snapshot = await readFartlekOSMSnapshot(file);
    expect(snapshot.metadata.coverageComplete).toBe(true);
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.records[0]).toMatchObject({ osmType: "way", osmId: "1" });
  });

  it("rejects snapshots with a wrong version, missing structure, or no sourceUrl", async () => {
    const { readFartlekOSMSnapshot, FARTLEK_OSM_SNAPSHOT_VERSION } = await import("./fartlekSnapshot.js");
    const directory = await mkdtemp(path.join(os.tmpdir(), "staza-fartlek-snapshot-"));
    temporaryDirectories.push(directory);

    const wrongVersion = path.join(directory, "wrong-version.ndjson");
    await writeFile(wrongVersion, `${JSON.stringify({
      metadata: { snapshotVersion: "fartlek-osm-snapshot-v0", sourceUrl: "https://example.test/extract" }
    })}\n`, "utf8");
    await expect(readFartlekOSMSnapshot(wrongVersion)).rejects.toThrow(/Unsupported Fartlek OSM snapshot version/);

    const missingMetadata = path.join(directory, "missing-metadata.ndjson");
    await writeFile(missingMetadata, `${JSON.stringify({ osmType: "way", osmId: "1" })}\n`, "utf8");
    await expect(readFartlekOSMSnapshot(missingMetadata)).rejects.toThrow(/first line must be a .*metadata.* object/);

    const missingSourceUrl = path.join(directory, "missing-source-url.ndjson");
    await writeFile(missingSourceUrl, `${JSON.stringify({
      metadata: { snapshotVersion: FARTLEK_OSM_SNAPSHOT_VERSION }
    })}\n`, "utf8");
    await expect(readFartlekOSMSnapshot(missingSourceUrl)).rejects.toThrow(/requires a sourceUrl/);
  });
});
