import { createReadStream } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_OSM_SNAPSHOT_FILE,
  OSM_SNAPSHOT_VERSION,
  recordsFromExportStream,
  type OSMSnapshotMetadata
} from "./snapshot.js";
import { OSM_ATTRIBUTION, OSM_COPYRIGHT_URL } from "./model.js";
import { OSM_SOURCE_CLASSES } from "./selectors.js";

const GEOFABRIK_URL = "https://download.geofabrik.de/europe/germany-latest.osm.pbf";

interface Arguments {
  input?: string;
  output: string;
  sourceUrl: string;
  sourceVersion?: string;
}

const argumentsFrom = (values: string[]): Arguments => {
  const result: Arguments = { output: DEFAULT_OSM_SNAPSHOT_FILE, sourceUrl: GEOFABRIK_URL };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const next = values[index + 1];
    if (value === "--input" || value === "--output" || value === "--source-url" ||
      value === "--source-version") {
      if (!next || next.startsWith("--")) throw new Error(`${value} requires a value.`);
      index += 1;
      if (value === "--input") result.input = next;
      else if (value === "--output") result.output = next;
      else if (value === "--source-url") result.sourceUrl = next;
      else result.sourceVersion = next;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return result;
};

const run = async (): Promise<void> => {
  const args = argumentsFrom(process.argv.slice(2));
  const input = args.input ? createReadStream(args.input) : process.stdin;
  const parsed = await recordsFromExportStream(input);
  const metadata: OSMSnapshotMetadata = {
    snapshotVersion: OSM_SNAPSHOT_VERSION,
    sourceUrl: args.sourceUrl,
    sourceVersion: args.sourceVersion ??
      `geofabrik-germany-${new Date().toISOString().slice(0, 10)}`,
    attribution: OSM_ATTRIBUTION,
    license: `ODbL 1.0 (${OSM_COPYRIGHT_URL})`,
    generatedAt: new Date().toISOString(),
    selectors: OSM_SOURCE_CLASSES.map(([key, value]) => `${key}=${value}`),
    coverageComplete: true,
    scanned: parsed.records.length,
    exportedFeatures: parsed.scanned,
    skippedFeatures: parsed.skipped
  };
  const target = path.resolve(args.output);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  const lines = [
    "{",
    `  "metadata": ${JSON.stringify(metadata, null, 2).split("\n").join("\n  ")},`,
    '  "records": [',
    ...parsed.records.map((record, index) =>
      `    ${JSON.stringify(record)}${index === parsed.records.length - 1 ? "" : ","}`),
    "  ]",
    "}",
    ""
  ];
  await writeFile(temporary, lines.join("\n"), "utf8");
  await rename(temporary, target);
  console.log(`Snapshot written: ${target}\n` +
    `Features read: ${parsed.scanned}\nRecords kept: ${parsed.records.length}\n` +
    `Skipped (no selector match or geometry): ${parsed.skipped}\n` +
    `Source version: ${metadata.sourceVersion}`);
};

const readStdinIsTTY = process.stdin.isTTY === true;
if (readStdinIsTTY && !process.argv.includes("--input")) {
  throw new Error("Provide --input <geojsonseq file> or pipe osmium export output on stdin.");
}
await run();
