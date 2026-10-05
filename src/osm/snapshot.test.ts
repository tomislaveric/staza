import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeOSMRecords } from "./normalize.js";
import {
  OSM_SNAPSHOT_VERSION,
  readOSMSnapshot,
  recordFromExportFeature,
  recordsFromExportStream
} from "./snapshot.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

const feature = (
  id: string,
  geometry: Record<string, unknown>,
  properties: Record<string, unknown>
): string => JSON.stringify({ type: "Feature", id, geometry, properties });

describe("OSM export conversion", () => {
  it("keeps selected classes, retained tags, and bounding-box centers", () => {
    const node = recordFromExportFeature(JSON.parse(feature(
      "n1001",
      { type: "Point", coordinates: [11.5, 48.1] },
      { tourism: "viewpoint", name: "Aussicht", wikidata: "Q1", "source:date": "2020" }
    )));
    expect(node).toEqual({
      osmType: "node",
      osmId: "1001",
      latitude: 48.1,
      longitude: 11.5,
      tags: { tourism: "viewpoint", name: "Aussicht", wikidata: "Q1" }
    });

    const way = recordFromExportFeature(JSON.parse(feature(
      "w2002",
      { type: "Polygon", coordinates: [[[10, 48], [11, 48], [11, 49], [10, 49], [10, 48]]] },
      { place: "square", name: "Marktplatz" }
    )));
    expect(way).toMatchObject({ osmType: "way", osmId: "2002", latitude: 48.5, longitude: 10.5 });
  });

  it("drops features without a selected class", () => {
    expect(recordFromExportFeature(JSON.parse(feature(
      "n3003",
      { type: "Point", coordinates: [11, 48] },
      { amenity: "bench", name: "Bank" }
    )))).toBeUndefined();
  });

  it("streams geojsonseq lines into deduplicated sorted records", async () => {
    const lines = [
      `\u001e${feature("n1", { type: "Point", coordinates: [11, 48] }, { natural: "peak", name: "Gipfel" })}`,
      feature("n1", { type: "Point", coordinates: [11, 48] }, { natural: "peak", name: "Gipfel" }),
      feature("n2", { type: "Point", coordinates: [12, 49] }, { amenity: "bench" }),
      "not json",
      ""
    ].join("\n");

    const parsed = await recordsFromExportStream(Readable.from([lines]));

    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0].osmId).toBe("1");
    expect(parsed.scanned).toBe(4);
    expect(parsed.skipped).toBe(2);
  });
});

describe("committed snapshot distribution", () => {
  it("ships fixtures in the runtime image so the importer can read the snapshot", async () => {
    const dockerfile = await (await import("node:fs/promises")).readFile("Dockerfile", "utf8");
    expect(dockerfile).toContain("COPY fixtures ./fixtures");
  });
});

describe("OSM snapshot file", () => {
  const writeSnapshot = async (document: unknown): Promise<string> => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "staza-snapshot-"));
    temporaryDirectories.push(directory);
    const file = path.join(directory, "osm-germany.json");
    await writeFile(file, JSON.stringify(document), "utf8");
    return file;
  };

  it("reads records that normalize through the regular pipeline", async () => {
    const file = await writeSnapshot({
      metadata: {
        snapshotVersion: OSM_SNAPSHOT_VERSION,
        sourceUrl: "https://download.geofabrik.de/europe/germany-latest.osm.pbf",
        sourceVersion: "geofabrik-germany-2026-10-05",
        generatedAt: "2026-10-05T18:00:00.000Z",
        scanned: 1
      },
      records: [
        { osmType: "node", osmId: "1", latitude: 48.1, longitude: 11.5, tags: { place: "square", name: "Marienplatz" } }
      ]
    });

    const snapshot = await readOSMSnapshot(file);
    const normalized = normalizeOSMRecords(snapshot.records);

    expect(snapshot.metadata.coverageComplete).toBe(true);
    expect(normalized.candidates).toHaveLength(1);
    expect(normalized.candidates[0].primaryCategory).toBe("place");
  });

  it("rejects snapshots with a wrong version or missing structure", async () => {
    const wrongVersion = await writeSnapshot({
      metadata: { snapshotVersion: "osm-snapshot-v0", sourceUrl: "https://example.test/extract" },
      records: []
    });
    await expect(readOSMSnapshot(wrongVersion)).rejects.toThrow(/Unsupported OSM snapshot version/);

    const missingRecords = await writeSnapshot({
      metadata: { snapshotVersion: OSM_SNAPSHOT_VERSION, sourceUrl: "https://example.test/extract" }
    });
    await expect(readOSMSnapshot(missingRecords)).rejects.toThrow(/metadata object and a records array/);
  });
});
