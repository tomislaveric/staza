import { describe, expect, it } from "vitest";
import { scoreFartlekCandidate } from "./fartlekScore.js";
import type { FartlekCandidate } from "./fartlekModel.js";

const baseCandidate = (overrides: Partial<FartlekCandidate> = {}): FartlekCandidate => ({
  id: "fartlek-candidate-1",
  name: "B500 Segment",
  coordinates: Array.from({ length: 10 }, (_, index) => [8 + index * 0.01, 48] as [number, number]),
  lengthMeters: 3_800,
  sourceWayIds: ["way:1", "way:2"],
  candidateGenerationVersion: "fartlek-candidates-v2",
  junctionCount: 1,
  trafficControlCount: 0,
  tagsBySegment: [],
  hasClearBoundaries: true,
  mostlyNonUrban: true,
  ...overrides
});

describe("scoreFartlekCandidate", () => {
  it("AUTO_PUBLISHes a continuous, well-mapped, low-junction candidate", () => {
    const candidate = baseCandidate({
      tagsBySegment: [
        { highway: "secondary", surface: "asphalt", smoothness: "good", bicycle: "yes", maxspeed: "80", ref: "B500" },
        { highway: "secondary", surface: "asphalt", smoothness: "excellent", bicycle: "yes", maxspeed: "80", ref: "B500" }
      ]
    });
    const scored = scoreFartlekCandidate(candidate);
    expect(scored.decision).toBe("AUTO_PUBLISH");
    expect(scored.suitabilityScore).toBeGreaterThanOrEqual(80);
    expect(scored.mappingConfidence).toBeGreaterThanOrEqual(85);
  });

  it("REVIEWs an incomplete-metadata candidate even with a continuous road", () => {
    const candidate = baseCandidate({
      lengthMeters: 4_100,
      tagsBySegment: [
        { highway: "secondary", surface: "asphalt" },
        { highway: "secondary" }
      ]
    });
    const scored = scoreFartlekCandidate(candidate);
    expect(scored.decision).toBe("REVIEW");
  });

  it("REJECTs bicycle=no candidates regardless of score", () => {
    const candidate = baseCandidate({
      tagsBySegment: [{ highway: "secondary", surface: "asphalt", bicycle: "no" }]
    });
    const scored = scoreFartlekCandidate(candidate);
    expect(scored.decision).toBe("REJECT");
    expect(scored.rejectionReason).toMatch(/bicycle=no/);
  });

  it("REJECTs candidates shorter than the 1 km minimum", () => {
    const candidate = baseCandidate({ lengthMeters: 500 });
    const scored = scoreFartlekCandidate(candidate);
    expect(scored.decision).toBe("REJECT");
  });

  it("never AUTO_PUBLISHes poor-quality roads with stop signs and inconsistent surface", () => {
    const candidate = baseCandidate({
      lengthMeters: 1_800,
      junctionCount: 6,
      trafficControlCount: 8,
      mostlyNonUrban: false,
      hasClearBoundaries: false,
      tagsBySegment: [
        { highway: "residential" },
        { highway: "residential", surface: "unpaved" }
      ]
    });
    const scored = scoreFartlekCandidate(candidate);
    expect(["IGNORE", "REVIEW", "REJECT"]).toContain(scored.decision);
  });

  it("never lets a high score override missing critical metadata into AUTO_PUBLISH", () => {
    const candidate = baseCandidate({
      junctionCount: 0,
      trafficControlCount: 0,
      tagsBySegment: [{ highway: "secondary", bicycle: "yes" }]
    });
    const scored = scoreFartlekCandidate(candidate);
    expect(scored.decision).not.toBe("AUTO_PUBLISH");
  });

  it("produces deterministic, explainable reasons (candidate score != gameplay XP)", () => {
    const candidate = baseCandidate();
    const first = scoreFartlekCandidate(candidate);
    const second = scoreFartlekCandidate(candidate);
    expect(first.reasons).toEqual(second.reasons);
    expect(first.suitabilityScore).not.toBe(50); // the gameplay XP constant, to make the distinction obvious
  });
});
