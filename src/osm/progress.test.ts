import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProgressLogger } from "./progress.js";
import { WikidataClient } from "./wikidata.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("progress logging", () => {
  it("formats events with a UTC clock time and scope", () => {
    const lines: string[] = [];
    const logger = createProgressLogger((line) => {
      lines.push(line);
    }, () => new Date("2026-10-05T18:04:09.000Z"));

    logger({ scope: "import", message: "Starting" });

    expect(lines).toEqual(["[18:04:09Z] [import] Starting"]);
  });

  it("reports Wikidata batch progress", async () => {
    const cacheDirectory = await mkdtemp(path.join(os.tmpdir(), "staza-progress-wikidata-"));
    temporaryDirectories.push(cacheDirectory);
    const messages: string[] = [];

    const client = new WikidataClient({
      cacheDirectory,
      fetcher: async () => new Response(JSON.stringify({ entities: { Q42: { id: "Q42" } } }), {
        status: 200
      }),
      sleeper: async () => undefined,
      random: () => 0,
      now: () => new Date("2026-10-01T10:00:00.000Z"),
      onProgress: (event) => {
        messages.push(`${event.scope}: ${event.message}`);
      }
    });

    await client.lookup(["Q42"]);

    expect(messages).toEqual([
      "wikidata: Resolving 1 QIDs: 0 cached, 1 to fetch in 1 batches",
      "wikidata: batch 1/1: requesting 1 QIDs (attempt 1/5)",
      "wikidata: batch 1/1: resolved 1 QIDs"
    ]);
  });
});
