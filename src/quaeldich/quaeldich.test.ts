import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { mountainPassValueFromElevation } from "./value.js";
import {
  normalizeQuaeldichCollection,
  normalizeQuaeldichFeature,
  passCollectibleId,
  passDeeplink
} from "./normalize.js";
import { planQuaeldichImport, formatImportReport } from "./import.js";
import type { Collectible } from "../domain.js";

const OPTIONS = { radiusMeters: 100 };

const feature = (overrides: Record<string, unknown> = {}) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [6.979551792144775, 44.68382263183594] },
  properties: { TextID: "col-agnel", name: "Col Agnel", ele: 2744 },
  ...overrides
});

describe("mountainPassValueFromElevation", () => {
  it("maps elevation onto bounded stepped tiers", () => {
    expect(mountainPassValueFromElevation(120)).toBe(100);
    expect(mountainPassValueFromElevation(499)).toBe(100);
    expect(mountainPassValueFromElevation(500)).toBe(150);
    expect(mountainPassValueFromElevation(999)).toBe(150);
    expect(mountainPassValueFromElevation(1000)).toBe(250);
    expect(mountainPassValueFromElevation(1499)).toBe(250);
    expect(mountainPassValueFromElevation(1500)).toBe(400);
    expect(mountainPassValueFromElevation(1999)).toBe(400);
    expect(mountainPassValueFromElevation(2000)).toBe(600);
    expect(mountainPassValueFromElevation(3200)).toBe(600);
  });

  it("falls back to the lowest tier for missing or invalid elevation", () => {
    expect(mountainPassValueFromElevation(undefined)).toBe(100);
    expect(mountainPassValueFromElevation(null)).toBe(100);
    expect(mountainPassValueFromElevation(Number.NaN)).toBe(100);
  });
});

describe("normalizeQuaeldichFeature", () => {
  it("maps a valid feature to a canonical mountain_pass collectible", () => {
    const result = normalizeQuaeldichFeature(feature(), OPTIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const c = result.collectible;
    expect(c.id).toBe("quaeldich:col-agnel");
    expect(c.type).toBe("mountain_pass");
    expect(c.latitude).toBe(44.68382263183594);
    expect(c.longitude).toBe(6.979551792144775);
    expect(c.radiusMeters).toBe(100);
    expect(c.elevationMeters).toBe(2744);
    expect(c.value).toBe(600);
    expect(c.rarity).toBe("common");
    expect(c.status).toBe("published");
    expect(c.source).toEqual({
      sourceType: "quaeldich",
      sourceExternalId: "col-agnel",
      sourceUrl: "https://www.quaeldich.de/paesse/col-agnel/",
      sourceAttribution: "quäldich.de"
    });
  });

  it("keeps elevation optional when the source omits it", () => {
    const result = normalizeQuaeldichFeature(
      feature({ properties: { TextID: "x", name: "X" } }),
      OPTIONS
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.collectible.elevationMeters).toBeUndefined();
    expect(result.collectible.value).toBe(100);
  });

  it("rejects missing TextID, invalid coordinates, and invalid elevation", () => {
    expect(normalizeQuaeldichFeature(feature({ properties: { name: "n", ele: 1 } }), OPTIONS).ok).toBe(false);
    expect(
      normalizeQuaeldichFeature(
        feature({ geometry: { type: "Point", coordinates: [999, 12] } }),
        OPTIONS
      ).ok
    ).toBe(false);
    expect(
      normalizeQuaeldichFeature(
        feature({ properties: { TextID: "t", name: "n", ele: 99999 } }),
        OPTIONS
      ).ok
    ).toBe(false);
  });

  it("builds stable deeplinks and ids from TextID", () => {
    expect(passDeeplink("col-agnel")).toBe("https://www.quaeldich.de/paesse/col-agnel/");
    expect(passCollectibleId("col-agnel")).toBe("quaeldich:col-agnel");
  });
});

describe("normalizeQuaeldichCollection", () => {
  it("normalizes the committed fixture, rejecting malformed and duplicate records", async () => {
    const payload = JSON.parse(
      await readFile(new URL("../../fixtures/quaeldich-sample.geojson", import.meta.url), "utf8")
    );
    const batch = normalizeQuaeldichCollection(payload, OPTIONS);
    expect(batch.fetchedCount).toBe(7);
    // valid: aecherlipass, col-agnel, alsbacher-schloss, no-elevation-pass
    expect(batch.collectibles.map((c) => c.id).sort()).toEqual([
      "quaeldich:aecherlipass",
      "quaeldich:alsbacher-schloss",
      "quaeldich:col-agnel",
      "quaeldich:no-elevation-pass"
    ]);
    // rejected: bad-coordinates, missing-textid, duplicate col-agnel
    expect(batch.rejected.length).toBe(3);
  });

  it("throws on a structurally invalid payload", () => {
    expect(() => normalizeQuaeldichCollection({ type: "Feature" }, OPTIONS)).toThrow();
    expect(() => normalizeQuaeldichCollection(null, OPTIONS)).toThrow();
  });
});

const sourced = (id: string, name: string, over: Partial<Collectible> = {}): Collectible => ({
  id: passCollectibleId(id),
  name,
  type: "mountain_pass",
  latitude: 47,
  longitude: 8,
  radiusMeters: 100,
  value: 250,
  rarity: "common",
  status: "published",
  elevationMeters: 1200,
  source: {
    sourceType: "quaeldich",
    sourceExternalId: id,
    sourceUrl: passDeeplink(id),
    sourceAttribution: "quäldich.de"
  },
  ...over
});

const batchOf = (collectibles: Collectible[]) => ({ collectibles, rejected: [], fetchedCount: collectibles.length });

describe("planQuaeldichImport", () => {
  it("categorizes created, unchanged, and updated rows without rotating ids", () => {
    const incoming = [sourced("a", "A"), sourced("b", "B updated", { name: "B updated" })];
    const existing = [sourced("b", "B"), sourced("c", "C")];
    const plan = planQuaeldichImport({ batch: batchOf(incoming), existingSource: existing });
    expect(plan.created.map((c) => c.id)).toEqual(["quaeldich:a"]);
    expect(plan.updated.map((c) => c.id)).toEqual(["quaeldich:b"]);
    expect(plan.missingUpstream.map((c) => c.id)).toEqual(["quaeldich:c"]);
  });

  it("treats an identical re-import as fully unchanged", () => {
    const rows = [sourced("a", "A"), sourced("b", "B")];
    const plan = planQuaeldichImport({ batch: batchOf(rows), existingSource: rows });
    expect(plan.created).toHaveLength(0);
    expect(plan.updated).toHaveLength(0);
    expect(plan.unchanged).toHaveLength(2);
  });

  it("reports proximity/name duplicates against non-source collectibles without merging", () => {
    const incoming = [sourced("schauinsland", "Schauinsland", { latitude: 47.9137, longitude: 7.8987 })];
    const curated: Collectible = {
      id: "curated-schauinsland",
      name: "Schauinsland",
      type: "landmark",
      latitude: 47.9138,
      longitude: 7.8988,
      radiusMeters: 15,
      value: 30
    };
    const plan = planQuaeldichImport({
      batch: batchOf(incoming),
      existingSource: [],
      otherCollectibles: [curated]
    });
    expect(plan.possibleDuplicates).toHaveLength(1);
    expect(plan.possibleDuplicates[0].existingId).toBe("curated-schauinsland");
    expect(plan.created).toHaveLength(1);
  });

  it("renders a compact human report", () => {
    const plan = planQuaeldichImport({ batch: batchOf([sourced("a", "A")]), existingSource: [] });
    const report = formatImportReport(plan, { sourceUrl: "https://example/geo", dryRun: true });
    expect(report).toContain("dry run");
    expect(report).toContain("Created:    1");
  });
});
