import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FartlekCandidate } from "./fartlekModel.js";
import { scoreFartlekCandidate } from "./fartlekScore.js";
import { flowlineAnalysisProfile, sampleFlowlineAnalysis } from "./flowlineAnalysis.js";

const row = (id: string, highway: string, maxspeed: string, name: string | undefined = "Road") => {
  const candidate: FartlekCandidate = {
    id, name, coordinates: [[8, 48], [8.04, 48]], lengthMeters: 3_000,
    sourceWayIds: [id], candidateGenerationVersion: "test", junctionCount: 0, trafficControlCount: 0,
    hasClearBoundaries: true, mostlyNonUrban: true,
    tagsBySegment: [{ highway, maxspeed, surface: "asphalt", smoothness: "good", bicycle: "yes" }]
  };
  return { scored: scoreFartlekCandidate(candidate) };
};

describe("Flowline curation analysis", () => {
  it("distinguishes named publication from eligibility and unnamed AUTO_PUBLISH decisions", () => {
    expect(flowlineAnalysisProfile(row("fast", "tertiary", "100").scored)).toMatchObject({
      published: false, speedBucket: ">=70"
    });
    const unnamed = row("unnamed", "tertiary", "50");
    delete unnamed.scored.candidate.name;
    expect(unnamed.scored.decision).toBe("AUTO_PUBLISH");
    expect(flowlineAnalysisProfile(unnamed.scored).published).toBe(false);
  });

  it("samples retained and removed groups deterministically across the full population", () => {
    const rows = Array.from({ length: 30 }, (_, index) => row(`road-${index}`, "tertiary", "50"));
    rows.push(row("fast", "secondary", "100"), row("cycleway", "cycleway", ""));
    const sample = sampleFlowlineAnalysis(rows, 2);
    expect(sample.map((item) => item.scored.candidate.id)).toEqual(
      sampleFlowlineAnalysis([...rows].reverse(), 2).map((item) => item.scored.candidate.id));
    expect(sample.filter((item) => flowlineAnalysisProfile(item.scored).published)).toHaveLength(3);
    expect(sample.some((item) => item.scored.rejectionReason === "REJECT_HIGH_SPEED_MOTOR_ROAD")).toBe(true);
    expect(sample.some((item) => item.scored.candidate.id === "cycleway")).toBe(true);
    const shortened = row("short", "tertiary", "100");
    shortened.scored.candidate.lengthMeters = 500;
    expect(sampleFlowlineAnalysis([shortened], 2)).toHaveLength(0);
  });

  it("reports actual named publication and checks baseline geometry through the existing CLI", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "staza-flowline-analysis-"));
    try {
      const candidates = [row("good", "tertiary", "50").scored.candidate,
        row("fast", "tertiary", "100").scored.candidate];
      const input = path.join(directory, "candidates.json");
      const baseline = path.join(directory, "baseline.json");
      const geojson = path.join(directory, "sample.geojson");
      const digest = createHash("sha256");
      for (const candidate of candidates) digest.update(JSON.stringify([candidate.id, candidate.coordinates]));
      await Promise.all([
        writeFile(input, JSON.stringify(candidates)),
        writeFile(baseline, JSON.stringify({
          candidateCount: 2, geometryDigest: digest.digest("hex"), publishedIds: ["good", "fast"]
        }))
      ]);
      const output = execFileSync(process.execPath, [
        "--import", "tsx", "src/osm/analyzeRoadSegments.ts", "--candidates", input,
        "--baseline-identities", baseline, "--geojson", geojson, "--sample-per-group", "1"
      ], { encoding: "utf8" });
      expect(output).toContain("2 candidate(s); 2 eligible");
      expect(output).toContain("publish.named: 1");
      expect(output).toContain("Named publication: 2 -> 1; removed=1, added=0");
      const exported = JSON.parse(await readFile(geojson, "utf8"));
      expect(exported.features).toHaveLength(2);
      expect(exported.features.find((feature: { properties: { id: string } }) => feature.properties.id === "fast").properties)
        .toMatchObject({ eligible: true, published: false, rejectionReason: "REJECT_HIGH_SPEED_MOTOR_ROAD" });
      await writeFile(baseline, JSON.stringify({ candidateCount: 2, geometryDigest: "wrong", publishedIds: ["good"] }));
      expect(() => execFileSync(process.execPath, [
        "--import", "tsx", "src/osm/analyzeRoadSegments.ts", "--candidates", input, "--baseline-identities", baseline
      ], { stdio: "pipe" })).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
