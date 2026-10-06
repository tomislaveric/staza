import { mkdir, rename } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { once } from "node:events";
import path from "node:path";
import {
  DEFAULT_FARTLEK_OSM_SNAPSHOT_FILE,
  FARTLEK_OSM_SNAPSHOT_VERSION,
  type FartlekOSMSnapshotMetadata
} from "./fartlekSnapshot.js";
import { fartlekRecordsFromExportStream } from "./fartlekNormalize.js";
import { OSM_ATTRIBUTION, OSM_COPYRIGHT_URL } from "./model.js";
import { FARTLEK_BOUNDARY_NODE_TAGS, FARTLEK_CONTROL_NODE_TAGS, FARTLEK_HIGHWAY_CLASSES } from "./fartlekSelectors.js";

const GEOFABRIK_URL = "https://download.geofabrik.de/europe/germany-latest.osm.pbf";

interface Arguments {
  input?: string;
  output: string;
  sourceUrl: string;
  sourceVersion?: string;
}

const argumentsFrom = (values: string[]): Arguments => {
  const result: Arguments = { output: DEFAULT_FARTLEK_OSM_SNAPSHOT_FILE, sourceUrl: GEOFABRIK_URL };
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
  const parsed = await fartlekRecordsFromExportStream(input);
  const selectors = [
    ...[...FARTLEK_HIGHWAY_CLASSES].map((value) => `highway=${value}`),
    ...FARTLEK_BOUNDARY_NODE_TAGS.map(([key, value]) => `${key}=${value}`),
    ...FARTLEK_CONTROL_NODE_TAGS.map(([key, value]) => `${key}=${value}`)
  ];
  const metadata: FartlekOSMSnapshotMetadata = {
    snapshotVersion: FARTLEK_OSM_SNAPSHOT_VERSION,
    sourceUrl: args.sourceUrl,
    sourceVersion: args.sourceVersion ??
      `geofabrik-germany-${new Date().toISOString().slice(0, 10)}`,
    attribution: OSM_ATTRIBUTION,
    license: `ODbL 1.0 (${OSM_COPYRIGHT_URL})`,
    generatedAt: new Date().toISOString(),
    selectors,
    coverageComplete: true,
    scanned: parsed.records.length,
    exportedFeatures: parsed.scanned,
    skippedFeatures: parsed.skipped
  };
  const target = path.resolve(args.output);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  // Stream the write (rather than building one giant joined string) to avoid doubling peak
  // memory on top of the already-large in-memory records array for a country-scale extract.
  const out = createWriteStream(temporary, { encoding: "utf8" });
  const write = async (chunk: string): Promise<void> => {
    if (!out.write(chunk)) await once(out, "drain");
  };
  await write("{\n");
  await write(`  "metadata": ${JSON.stringify(metadata, null, 2).split("\n").join("\n  ")},\n`);
  await write('  "records": [\n');
  for (let index = 0; index < parsed.records.length; index += 1) {
    const suffix = index === parsed.records.length - 1 ? "\n" : ",\n";
    await write(`    ${JSON.stringify(parsed.records[index])}${suffix}`);
  }
  await write("  ]\n}\n");
  out.end();
  await once(out, "finish");
  await rename(temporary, target);
  const wayCount = parsed.records.filter((record) => record.osmType === "way").length;
  const nodeCount = parsed.records.length - wayCount;
  console.log(`Fartlek snapshot written: ${target}\n` +
    `Features read: ${parsed.scanned}\nWays kept: ${wayCount}\nBoundary/control nodes kept: ${nodeCount}\n` +
    `Skipped (no selector match or geometry): ${parsed.skipped}\n` +
    `Source version: ${metadata.sourceVersion}`);
};

const readStdinIsTTY = process.stdin.isTTY === true;
if (readStdinIsTTY && !process.argv.includes("--input")) {
  throw new Error("Provide --input <geojsonseq file> or pipe osmium export output on stdin.");
}
await run();
