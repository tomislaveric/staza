import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeOSMRecord } from "./normalize.js";
import { enrichCandidates, WikidataClient } from "./wikidata.js";

const fixtureResponse = async () => JSON.parse(
  await readFile("fixtures/osm-wikidata/wikidata-entities.json", "utf8")
) as Record<string, Record<string, unknown>>;

const temporaryDirectories: string[] = [];
const makeCache = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "staza-wikidata-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

const makeCandidate = (qid: string, wikipedia: string) => {
  const result = normalizeOSMRecord({
    osmType: "node",
    osmId: qid.slice(1),
    latitude: qid === "Q1002" ? 47.8 : 48,
    longitude: qid === "Q1002" ? 7.83 : 7.9,
    tags: { natural: "peak", name: "Source name", wikidata: qid, wikipedia }
  });
  if (!result.ok) throw new Error(result.rejection.reason);
  return result.candidate;
};

describe("Wikidata enrichment", () => {
  it("can resolve a committed Q-ID cache fixture without network access", async () => {
    const fetcher = vi.fn();
    const client = new WikidataClient({
      cacheDirectory: "fixtures/osm-wikidata/cache",
      fetcher,
      now: () => new Date("2026-10-01T09:00:00.000Z")
    });
    const result = await client.lookup(["Q1001"]);
    expect(result.get("Q1001")).toMatchObject({
      cacheHit: true,
      entity: { id: "Q1001" }
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses direct Q-IDs and exact sitelink title matches, then caches the response", async () => {
    const entities = await fixtureResponse();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      entities: { Q1001: entities.Q1001, Q1002: entities.Q1002 }
    }), { status: 200, headers: { date: "Thu, 01 Oct 2026 08:00:00 GMT" } }));
    const client = new WikidataClient({
      cacheDirectory: await makeCache(),
      fetcher,
      now: () => new Date("2026-10-01T08:00:00.000Z")
    });
    const source = makeCandidate("Q1001", "de:Wachtelberg");
    const unresolvedReference = makeCandidate("Q1001", "de:Wachtelberg Aussicht");
    const result = await enrichCandidates([source, unresolvedReference], client);
    expect(result.directQidCount).toBe(2);
    expect(result.resolvedQidCount).toBe(2);
    expect(result.candidates[0]).toMatchObject({
      wikipediaSitelinkMatched: true,
      wikidataCompatible: true,
      wikidataEntityLabel: "Wachtelberg"
    });
    expect(result.candidates[1]).toMatchObject({
      wikipediaSitelinkMatched: false,
      wikidataCompatible: false
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    const cached = await client.lookup(["Q1001"]);
    expect(cached.get("Q1001")?.cacheHit).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("marks failed refreshes as stale cache and reports unresolved uncached Q-IDs", async () => {
    const entities = await fixtureResponse();
    const cacheDirectory = await makeCache();
    const cacheClient = new WikidataClient({
      cacheDirectory,
      sleeper: async () => undefined,
      fetcher: async () => new Response(JSON.stringify({ entities: { Q1001: entities.Q1001 } }), { status: 200 })
    });
    await cacheClient.lookup(["Q1001"]);
    const offlineClient = new WikidataClient({
      cacheDirectory,
      fetcher: async () => { throw new Error("offline"); },
      sleeper: async () => undefined,
      random: () => 0
    });
    const result = await offlineClient.lookup(["Q1001", "Q1002"], { forceRefresh: true });
    expect(result.get("Q1001")).toMatchObject({
      stale: true,
      cacheHit: true,
      entity: { id: "Q1001" },
      attempts: 5
    });
    expect(result.get("Q1002")).toMatchObject({ error: "offline", attempts: 5 });
  });

  it("retries transient Wikidata failures, honors Retry-After, and stops at five attempts", async () => {
    const delays: number[] = [];
    const sleeper = vi.fn(async (milliseconds: number) => {
      delays.push(milliseconds);
    });
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response("slow down", { status: 429, headers: { "retry-after": "3" } });
      if (calls === 2) return new Response("server error", { status: 503 });
      return new Response(JSON.stringify({ entities: { Q1001: { id: "Q1001" } } }), { status: 200 });
    });
    const client = new WikidataClient({
      cacheDirectory: await makeCache(),
      fetcher,
      sleeper,
      random: () => 0,
      now: () => new Date("2026-10-01T08:00:00.000Z")
    });

    const result = await client.lookup(["Q1001"]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([3000, 2000]);
    expect(result.get("Q1001")).toMatchObject({ entity: { id: "Q1001" }, attempts: 3 });

    const exhausted = new WikidataClient({
      cacheDirectory: await makeCache(),
      fetcher: async () => new Response("server error", { status: 503 }),
      sleeper: async () => undefined,
      random: () => 0
    });
    expect((await exhausted.lookup(["Q1001"])).get("Q1001")).toMatchObject({
      error: "Wikidata returned HTTP 503.",
      attempts: 5
    });
  });

  it("does not retry non-transient Wikidata client errors", async () => {
    const fetcher = vi.fn(async () => new Response("bad request", { status: 400 }));
    const client = new WikidataClient({
      cacheDirectory: await makeCache(),
      fetcher,
      sleeper: async () => {
        throw new Error("non-transient failures must not back off");
      }
    });

    expect((await client.lookup(["Q1001"])).get("Q1001")).toMatchObject({
      error: "Wikidata returned HTTP 400.",
      attempts: 1
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("waits five seconds between uncached batches by default but not before the first request", async () => {
    const qids = Array.from({ length: 51 }, (_value, index) => `Q${index + 1}`);
    const sleeper = vi.fn(async () => undefined);
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const ids = new URL(String(url)).searchParams.get("ids")?.split("|") ?? [];
      return new Response(JSON.stringify({
        entities: Object.fromEntries(ids.map((qid) => [qid, { id: qid }]))
      }), { status: 200 });
    });
    const client = new WikidataClient({
      cacheDirectory: await makeCache(),
      fetcher,
      batchDelayMs: 750,
      sleeper
    });

    const result = await client.lookup(qids);

    expect(result.size).toBe(51);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleeper).toHaveBeenCalledTimes(1);
    expect(sleeper).toHaveBeenCalledWith(750);

    const defaultSleeper = vi.fn(async () => undefined);
    const defaultClient = new WikidataClient({
      cacheDirectory: await makeCache(),
      fetcher,
      sleeper: defaultSleeper
    });
    await defaultClient.lookup(qids);
    expect(defaultSleeper).toHaveBeenCalledWith(5000);
  });
});
