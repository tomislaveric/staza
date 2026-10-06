import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Collectible } from "../domain.js";
import { normalizeOSMJsonLines, normalizeOSMRecord } from "./normalize.js";
import { formatOSMImportReport, planOSMImport } from "./import.js";
import { scoreCandidate } from "./score.js";
import { enrichCandidates, WikidataClient } from "./wikidata.js";

const extractionMetadata = {
  sourceUrl: "https://download.geofabrik.de/europe/germany-latest.osm.pbf",
  sourceVersion: "geofabrik-germany-2026-10-01",
  generatedAt: "2026-10-01T08:00:00.000Z",
  coverageComplete: true,
  scanned: 10
};
const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

const buildPlan = async (existing: Collectible[] = []) => {
  const records = normalizeOSMJsonLines(await readFile("fixtures/osm-wikidata/candidates.jsonl", "utf8"));
  const fixtureEntities = JSON.parse(
    await readFile("fixtures/osm-wikidata/wikidata-entities.json", "utf8")
  ) as Record<string, Record<string, unknown>>;
  const cacheDirectory = await mkdtemp(path.join(os.tmpdir(), "staza-osm-import-"));
  temporaryDirectories.push(cacheDirectory);
  const client = new WikidataClient({
    cacheDirectory,
    fetcher: async () => new Response(JSON.stringify({ entities: fixtureEntities }), { status: 200 }),
    now: () => new Date("2026-10-01T08:10:00.000Z")
  });
  const enriched = await enrichCandidates(records.candidates, client);
  const scored = enriched.candidates.map(scoreCandidate);
  return planOSMImport({
    scanned: extractionMetadata.scanned,
    candidates: enriched.candidates,
    scored,
    rejected: records.rejected,
    existing,
    directQidCount: enriched.directQidCount,
    resolvedQidCount: enriched.resolvedQidCount,
    unmatchedQidCount: enriched.unmatchedQidCount,
    extractMetadata: extractionMetadata
  });
};

describe("OSM import planning", () => {
  it("imports only AUTO_PUBLISH, groups shared Wikidata entities, and reports risks", async () => {
    const plan = await buildPlan();
    expect(plan.created.map((item) => item.id).sort()).toEqual([
      "osm:node:1001",
      "osm:node:2001",
      "osm:way:3001",
      "osm:way:4001"
    ]);
    const castle = plan.created.find((item) => item.id === "osm:way:3001");
    expect(castle).toMatchObject({
      primaryCategory: "castle",
      tags: ["attraction", "historic", "viewpoint"],
      source: { sourceType: "osm", sourceExternalId: "way:3001" },
      wikidataQid: "Q1003",
      wikipediaReference: "de:Schloss_Beispiel",
      rarity: "common",
      value: 35,
      radiusMeters: 100
    });
    expect(plan.possibleDuplicates).toContainEqual(expect.objectContaining({
      candidateId: "osm:node:3002",
      matchedId: "osm:way:3001",
      identityMatch: "wikidata"
    }));
    expect(plan.decisions).toMatchObject({
      AUTO_PUBLISH: 4,
      REVIEW: 2,
      IGNORE: 1,
      REJECT: 3
    });
    expect(plan.directQidCount).toBe(6);
    expect(plan.resolvedQidCount).toBe(6);
    expect(plan.unmatchedQidCount).toBe(0);
  });

  it("is idempotent across identical cached snapshots", async () => {
    const first = await buildPlan();
    const second = await buildPlan(first.created);
    expect(second.created).toEqual([]);
    expect(second.updated).toEqual([]);
    expect(second.unchanged.map((item) => item.id).sort())
      .toEqual(first.created.map((item) => item.id).sort());
    expect(second.missingUpstream).toEqual([]);
  });

  it("plans metadata changes as updates to the existing canonical ID", async () => {
    const first = await buildPlan();
    const oldRow = { ...first.created[0], name: "Old Source Name" };
    const next = await buildPlan([oldRow]);
    expect(next.updated.map((item) => item.id)).toContain(oldRow.id);
    expect(next.created.map((item) => item.id)).not.toContain(oldRow.id);
  });

  it("reports vanished OSM identities but never deletes or archives them", async () => {
    const existing: Collectible = {
      id: "osm:node:old",
      name: "Old viewpoint",
      type: "landmark",
      primaryCategory: "viewpoint",
      latitude: 48,
      longitude: 8,
      radiusMeters: 100,
      value: 20,
      source: { sourceType: "osm", sourceExternalId: "node:old" }
    };
    const plan = await buildPlan([existing]);
    expect(plan.missingUpstream).toEqual([existing]);
    expect(plan.created).not.toContainEqual(existing);
  });

  it("suppresses missing-upstream conclusions for incomplete coverage", async () => {
    const existing: Collectible = {
      id: "osm:node:old",
      name: "Old viewpoint",
      type: "landmark",
      latitude: 48,
      longitude: 8,
      radiusMeters: 100,
      value: 20,
      source: { sourceType: "osm", sourceExternalId: "node:old" }
    };
    const records = normalizeOSMJsonLines("");
    const plan = planOSMImport({
      scanned: 0,
      candidates: records.candidates,
      scored: [],
      rejected: [],
      existing: [existing],
      directQidCount: 0,
      resolvedQidCount: 0,
      unmatchedQidCount: 0,
      extractMetadata: { coverageComplete: false },
      coverageComplete: false
    });
    expect(plan.missingUpstream).toEqual([]);
  });

  it("counts and reports place candidates alongside the existing categories", () => {
    const records = [
      { osmId: "600", tags: { place: "square", name: "Marktplatz Beispiel", heritage: "4", wikidata: "Q9", access: "yes" } },
      { osmId: "601", tags: { tourism: "attraction", name: "Beispielbrunnen" } }
    ].map(({ osmId, tags }, index) => {
      const normalized = normalizeOSMRecord({
        osmType: "node", osmId, latitude: 48 + index, longitude: 8, tags
      });
      if (!normalized.ok) throw new Error(normalized.rejection.reason);
      return normalized.candidate;
    });
    const scored = records.map((candidate, index) =>
      scoreCandidate(index === 0 ? { ...candidate, wikipediaSitelinkMatched: true } : candidate));
    const plan = planOSMImport({
      scanned: 2,
      candidates: records,
      scored,
      rejected: [],
      existing: [],
      directQidCount: 1,
      resolvedQidCount: 1,
      unmatchedQidCount: 0,
      extractMetadata: {}
    });

    expect(plan.categories.place).toBe(2);
    expect(plan.created).toEqual([expect.objectContaining({
      id: "osm:node:600",
      primaryCategory: "place",
      type: "landmark",
      tags: ["historic", "square"],
      value: 25,
      radiusMeters: 100
    })]);
    expect(formatOSMImportReport(plan, {
      dryRun: true,
      sourceUrl: "https://download.geofabrik.de/europe/germany-latest.osm.pbf",
      extractMetadata: {}
    })).toContain("viewpoint / peak / castle / waterfall / place: 0 / 0 / 0 / 0 / 2");
  });

  it("reports close same-name candidates without merging or publishing them", () => {
    const records = ["11", "12"].map((osmId, index) => {
      const normalized = normalizeOSMRecord({
        osmType: "node",
        osmId,
        latitude: 48,
        longitude: 8 + index * 0.00005,
        tags: { tourism: "viewpoint", name: "Example Lookout", access: "yes", direction: "180" }
      });
      if (!normalized.ok) throw new Error(normalized.rejection.reason);
      return normalized.candidate;
    });
    const scored = records.map(scoreCandidate);
    const plan = planOSMImport({
      scanned: 2,
      candidates: records,
      scored,
      rejected: [],
      existing: [],
      directQidCount: 0,
      resolvedQidCount: 0,
      unmatchedQidCount: 0,
      extractMetadata: {}
    });
    expect(plan.possibleDuplicates).toEqual([
      expect.objectContaining({
        identityMatch: "name-distance",
        candidateId: "osm:node:12",
        matchedId: "osm:node:11"
      })
    ]);
    expect(plan.created).toEqual([]);
  });

  it("keeps conflicting direct Q-IDs tied to one exact Wikipedia page in review", () => {
    const candidates = ["Q123", "Q456"].map((qid, index) => {
      const normalized = normalizeOSMRecord({
        osmType: "node",
        osmId: String(20 + index),
        latitude: 48,
        longitude: 8 + index * 0.001,
        tags: {
          tourism: "viewpoint",
          name: `Lookout ${index}`,
          access: "yes",
          direction: "180",
          wikidata: qid,
          wikipedia: "de:Shared_Page"
        }
      });
      if (!normalized.ok) throw new Error(normalized.rejection.reason);
      return {
        ...normalized.candidate,
        wikipediaSitelinkMatched: true,
        wikidataCompatible: true
      };
    });
    const scored = candidates.map(scoreCandidate);
    expect(scored.every((item) => item.decision === "AUTO_PUBLISH")).toBe(true);
    const plan = planOSMImport({
      scanned: 2,
      candidates,
      scored,
      rejected: [],
      existing: [],
      directQidCount: 2,
      resolvedQidCount: 2,
      unmatchedQidCount: 0,
      extractMetadata: {}
    });
    expect(plan.decisions).toMatchObject({ AUTO_PUBLISH: 0, REVIEW: 2 });
    expect(plan.created).toEqual([]);
    expect(plan.possibleDuplicates).toEqual([
      expect.objectContaining({ identityMatch: "wikipedia" })
    ]);
  });
});
