import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import type { Fartlek } from "../domain.js";
import { FartlekRepository } from "./fartlekRepository.js";

const flowline = (): Fartlek => ({
  id: "fartlek-osm-v3:way-1:way-2:0:8",
  name: "B 1",
  geometry: { type: "LineString", coordinates: [[8, 48], [8.1, 48.1]] },
  startLatitude: 48,
  startLongitude: 8,
  endLatitude: 48.1,
  endLongitude: 8.1,
  lengthMeters: 10_000,
  status: "published",
  source: {
    sourceType: "osm",
    sourceExternalId: "fartlek-osm-v3:way-1:way-2:0:8"
  },
  suitabilityScore: 90,
  suitabilityReasons: ["SURFACE_GOOD"],
  mappingConfidence: 85,
  geometryVersion: 1
});

const repositoryWithQueryLog = () => {
  const calls: { sql: string; values?: unknown[] }[] = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return { rows: [], rowCount: 1 };
    },
    release: () => undefined
  };
  const pool = { connect: async () => client };
  return { repository: new FartlekRepository(pool as unknown as Pool), calls };
};

describe("FartlekRepository complete snapshot synchronization", () => {
  it("archives absent OSM Flowlines in the same transaction as upserts without deleting history", async () => {
    const { repository, calls } = repositoryWithQueryLog();
    await repository.upsertMany([flowline()], { archiveAbsentOsmFlowlines: true });

    expect(calls[0].sql).toBe("BEGIN");
    expect(calls.some((call) => call.sql.includes("INSERT INTO fartleks"))).toBe(true);
    const archive = calls.find((call) => call.sql.includes("SET status = 'archived'"));
    expect(archive?.sql).toContain("source_type = 'osm'");
    expect(archive?.sql).toContain("source_external_id = ANY($1::text[])");
    expect(archive?.values).toEqual([["fartlek-osm-v3:way-1:way-2:0:8"]]);
    expect(calls.at(-1)?.sql).toBe("COMMIT");
    expect(calls.every((call) => !/\bDELETE\b/i.test(call.sql))).toBe(true);
  });

  it("can archive the entire OSM catalog for a verified complete snapshot with no publishable rows", async () => {
    const { repository, calls } = repositoryWithQueryLog();
    await repository.upsertMany([], { archiveAbsentOsmFlowlines: true });

    expect(calls.map((call) => call.sql)).toEqual([
      "BEGIN",
      expect.stringContaining("SET status = 'archived'"),
      "COMMIT"
    ]);
    expect(calls[1].values).toEqual([[]]);
  });

  it("does not connect or archive for an empty partial import", async () => {
    const { repository, calls } = repositoryWithQueryLog();
    expect(await repository.upsertMany([])).toBe(0);
    expect(calls).toEqual([]);
  });
});
