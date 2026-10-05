import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { normalizeOSMJsonLines, normalizeOSMRecord } from "./normalize.js";
import { scoreCandidate } from "./score.js";

const candidate = (tags: Record<string, string>, id = "10") => {
  const result = normalizeOSMRecord({
    osmType: "node",
    osmId: id,
    latitude: 48,
    longitude: 8,
    tags
  });
  if (!result.ok) throw new Error(result.rejection.reason);
  return result.candidate;
};

describe("OSM normalization", () => {
  it("accepts only the four explicit source classes and applies category precedence", () => {
    const castle = normalizeOSMRecord({
      osmType: "way",
      osmId: "99",
      latitude: 48,
      longitude: 8,
      tags: { historic: "castle", natural: "peak", tourism: "viewpoint", name: "Schloss Sample", ele: "500 m" }
    });
    expect(castle.ok && castle.candidate.primaryCategory).toBe("castle");
    expect(castle.ok && castle.candidate.categories).toEqual(["castle", "peak", "viewpoint"]);
    expect(castle.ok && castle.candidate.tagsForCatalog).toEqual(["historic", "summit", "viewpoint"]);

    const viewpoint = normalizeOSMRecord({
      osmType: "node", osmId: "98", latitude: 48, longitude: 8,
      tags: { tourism: "viewpoint", name: "Lookout" }
    });
    expect(viewpoint.ok && viewpoint.candidate.tagsForCatalog).toEqual([]);

    expect(normalizeOSMRecord({
      osmType: "node", osmId: "1", latitude: 48, longitude: 8, tags: { tourism: "museum" }
    })).toMatchObject({ ok: false });
  });

  it("rejects invalid geometry, identity, Q-IDs, and unusable explicit names", () => {
    for (const record of [
      { osmType: "node", osmId: "0", latitude: 48, longitude: 8, tags: { natural: "peak" } },
      { osmType: "node", osmId: "2", latitude: 91, longitude: 8, tags: { natural: "peak" } },
      { osmType: "node", osmId: "3", latitude: 48, longitude: 8, tags: { natural: "peak", wikidata: "123" } },
      { osmType: "node", osmId: "4", latitude: 48, longitude: 8, tags: { natural: "peak", name: "Unnamed" } }
    ]) expect(normalizeOSMRecord(record)).toMatchObject({ ok: false });

    const unnamed = normalizeOSMRecord({
      osmType: "node", osmId: "5", latitude: 48, longitude: 8, tags: { natural: "peak" }
    });
    expect(unnamed.ok).toBe(true);
    if (unnamed.ok) expect(unnamed.candidate).not.toHaveProperty("name");
  });

  it("imports named squares, quarters, and standalone attractions as place candidates", () => {
    const square = normalizeOSMRecord({
      osmType: "way", osmId: "500", latitude: 48, longitude: 8,
      tags: { place: "square", name: "Marktplatz Beispiel", heritage: "4" }
    });
    expect(square.ok && square.candidate.primaryCategory).toBe("place");
    expect(square.ok && square.candidate.categories).toEqual(["place"]);
    expect(square.ok && square.candidate.tagsForCatalog).toEqual(["historic", "square"]);

    const quarter = normalizeOSMRecord({
      osmType: "relation", osmId: "501", latitude: 48, longitude: 8,
      tags: { place: "quarter", name: "Beispielviertel" }
    });
    expect(quarter.ok && quarter.candidate.primaryCategory).toBe("place");
    expect(quarter.ok && quarter.candidate.tagsForCatalog).toEqual(["quarter"]);

    const attraction = normalizeOSMRecord({
      osmType: "node", osmId: "502", latitude: 48, longitude: 8,
      tags: { tourism: "attraction", name: "Beispielbrunnen" }
    });
    expect(attraction.ok && attraction.candidate.primaryCategory).toBe("place");
    expect(attraction.ok && attraction.candidate.tagsForCatalog).toEqual(["attraction"]);
  });

  it("keeps existing categories ahead of place and requires a meaningful place name", () => {
    const castle = normalizeOSMRecord({
      osmType: "way", osmId: "503", latitude: 48, longitude: 8,
      tags: { historic: "castle", tourism: "attraction", place: "square", name: "Schloss Beispiel" }
    });
    expect(castle.ok && castle.candidate.primaryCategory).toBe("castle");
    expect(castle.ok && castle.candidate.categories).toEqual(["castle", "place"]);
    expect(castle.ok && castle.candidate.tagsForCatalog).toEqual(["attraction", "historic", "square"]);

    for (const tags of [
      { tourism: "attraction" },
      { place: "square" },
      { tourism: "attraction", name: "Attraction" },
      { place: "square", name: "Marktplatz" }
    ]) {
      expect(normalizeOSMRecord({
        osmType: "node", osmId: "504", latitude: 48, longitude: 8, tags
      })).toMatchObject({ ok: false });
    }
  });

  it("reports malformed JSON and duplicate OSM object identities without overriding the first", async () => {
    const fixture = await readFile("fixtures/osm-wikidata/candidates.jsonl", "utf8");
    const normalized = normalizeOSMJsonLines(fixture);
    expect(normalized.candidates.some((item) => item.id === "osm:node:1001")).toBe(true);
    expect(normalized.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "Duplicate OSM source identity." }),
      expect.objectContaining({ reason: "Invalid representative coordinates." })
    ]));
    expect(normalizeOSMJsonLines("{not-json}\n").rejected[0].reason).toBe("Malformed JSONL record.");
  });
});

describe("explainable collectible scoring", () => {
  it("reproduces category score examples and every decision band", () => {
    const viewpointAuto = scoreCandidate({
      ...candidate({
      tourism: "viewpoint", name: "Turmberg", wikidata: "Q1", wikipedia: "de:Turmberg",
      foot: "yes", direction: "180"
      }),
      wikipediaSitelinkMatched: true
    });
    expect(viewpointAuto).toMatchObject({ score: 80, decision: "AUTO_PUBLISH" });

    const viewpointReview = scoreCandidate(candidate({
      tourism: "viewpoint", name: "Turmberg", wikidata: "Q1", foot: "yes", direction: "180"
    }));
    expect(viewpointReview).toMatchObject({ score: 60, decision: "REVIEW" });

    const peakAuto = scoreCandidate({
      ...candidate({
      natural: "peak", name: "Mount Gipfel", wikidata: "Q2", wikipedia: "de:Gipfel", access: "yes",
      prominence: "310", tourism: "viewpoint"
      }),
      wikipediaSitelinkMatched: true
    });
    expect(peakAuto).toMatchObject({ score: 95, decision: "AUTO_PUBLISH" });

    const peakReview = scoreCandidate(candidate({
      natural: "peak", name: "Mount Gipfel", access: "yes", prominence: "200", tourism: "viewpoint"
    }));
    expect(peakReview).toMatchObject({ score: 52, decision: "REVIEW" });

    const weak = scoreCandidate(candidate({ tourism: "viewpoint", direction: "120" }));
    expect(weak).toMatchObject({ score: 0, decision: "IGNORE" });
    expect(scoreCandidate(candidate({ tourism: "viewpoint", access: "private" })).decision).toBe("REJECT");

    const castleAuto = candidate({
      historic: "castle", name: "Castle Name", wikidata: "Q3", wikipedia: "de:Castle",
      access: "yes", castle_type: "manor", heritage: "4", tourism: "attraction"
    });
    expect(scoreCandidate({ ...castleAuto, wikipediaSitelinkMatched: true }).score).toBe(90);
    expect(scoreCandidate(candidate({
      historic: "castle", name: "Castle Name", wikidata: "Q3", access: "yes", castle_type: "manor"
    })).score).toBe(60);
    expect(scoreCandidate(candidate({
      historic: "castle", name: "Small Castle", heritage: "4"
    })).score).toBe(35);
    const waterfallAuto = candidate({
      waterway: "waterfall", name: "Tall Fall", wikidata: "Q4", wikipedia: "de:Fall",
      access: "yes", height: "10", website: "https://example.invalid"
    });
    expect(scoreCandidate({ ...waterfallAuto, wikipediaSitelinkMatched: true }).score).toBe(95);
    expect(scoreCandidate(candidate({
      waterway: "waterfall", name: "Small Fall", wikidata: "Q4", access: "yes", height: "10"
    })).score).toBe(65);
    expect(scoreCandidate(candidate({ waterway: "waterfall", height: "3" })).score).toBe(0);
  });

  it("scores places from deterministic, explainable evidence without lowering thresholds", () => {
    const squareAuto = candidate({
      place: "square", name: "Marktplatz Beispiel", wikidata: "Q5", wikipedia: "de:Marktplatz",
      heritage: "4", access: "yes"
    }, "505");
    const scoredAuto = scoreCandidate({ ...squareAuto, wikipediaSitelinkMatched: true });
    expect(scoredAuto).toMatchObject({ score: 90, decision: "AUTO_PUBLISH" });
    expect(scoredAuto.reasons).toContain("Explicit place=square classification: +10");
    expect(scoredAuto.reasons).toContain("Structured heritage/historic identity: +10");

    const quarterReview = scoreCandidate({
      ...candidate({ place: "quarter", name: "Beispielviertel", wikidata: "Q6", wikipedia: "de:Viertel" }, "506"),
      wikipediaSitelinkMatched: true
    });
    expect(quarterReview).toMatchObject({ score: 70, decision: "REVIEW" });

    const attractionWeak = scoreCandidate(candidate({
      tourism: "attraction", name: "Beispielbrunnen"
    }, "507"));
    expect(attractionWeak).toMatchObject({ score: 25, decision: "IGNORE" });
    expect(attractionWeak.reasons).not.toContain("Explicit place=square classification: +10");

    expect(scoreCandidate(candidate({
      place: "square", name: "Privater Platz", access: "private"
    }, "508")).decision).toBe("REJECT");
  });

  it("does not award stacked elevation/prominence or score access-conflicted targets", () => {
    const peak = scoreCandidate(candidate({
      natural: "peak", name: "Mount Sample", ele: "1000", prominence: "120", access: "yes"
    }));
    expect(peak.score).toBe(47);
    expect(peak.reasons).toContain("Prominence 100-299 m: +12");
    expect(peak.reasons).not.toContain("Elevation only: +5");
    expect(scoreCandidate(candidate({
      natural: "peak", name: "Mount Sample", access: "yes", foot: "no"
    })).decision).toBe("REJECT");
  });
});
