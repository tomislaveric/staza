import { describe, expect, it } from "vitest";
import type { FartlekCandidate } from "./fartlekModel.js";
import { scoreFartlekCandidate } from "./fartlekScore.js";
import {
  calculateRoadCyclingFlowlineDataConfidence,
  classifyRoadCyclingSmoothness,
  classifyRoadCyclingSurface,
  isRoadCyclingAccessible,
  shouldPublishRoadCyclingFlowline
} from "./roadCyclingFlowlineQuality.js";

const candidate = (tags: Record<string, string>[], overrides: Partial<FartlekCandidate> = {}): FartlekCandidate => ({
  id: "flowline-test",
  name: "Rural Road",
  coordinates: [[8, 48], [8.04, 48]],
  lengthMeters: 3_000,
  sourceWayIds: ["way-1"],
  candidateGenerationVersion: "test-v1",
  junctionCount: 1,
  trafficControlCount: 0,
  tagsBySegment: tags,
  hasClearBoundaries: true,
  mostlyNonUrban: true,
  ...overrides
});

describe("road cycling surface and smoothness classification", () => {
  it.each(["asphalt", "concrete", "chipseal"])("classifies %s as good", (surface) => {
    expect(classifyRoadCyclingSurface(surface)).toBe("GOOD");
  });

  it("classifies generic paved as acceptable and keeps unknown values unknown", () => {
    expect(classifyRoadCyclingSurface("paved")).toBe("ACCEPTABLE");
    expect(classifyRoadCyclingSurface(undefined)).toBe("UNKNOWN");
    expect(classifyRoadCyclingSurface("survey;unmapped")).toBe("UNKNOWN");
  });

  it.each(["gravel", "fine_gravel", "dirt", "compacted", "paving_stones", "concrete:plates"])(
    "rejects the road surface %s",
    (surface) => expect(classifyRoadCyclingSurface(surface)).toBe("BAD")
  );

  it("rejects ambiguous composites containing an unsuitable material", () => {
    expect(classifyRoadCyclingSurface("asphalt;paving_stones")).toBe("BAD");
    expect(classifyRoadCyclingSurface("asphalt;gravel")).toBe("BAD");
  });

  it("classifies smoothness independently of missing surface", () => {
    expect(classifyRoadCyclingSmoothness("excellent")).toBe("GOOD");
    expect(classifyRoadCyclingSmoothness("intermediate")).toBe("ACCEPTABLE");
    expect(classifyRoadCyclingSmoothness("very_bad")).toBe("BAD");
    expect(classifyRoadCyclingSmoothness(undefined)).toBe("UNKNOWN");
  });
});

describe("road cycling Flowline suitability", () => {
  it("accepts secondary asphalt, tertiary paved, and unclassified asphalt with explicit bicycle access", () => {
    const tagSets: Record<string, string>[] = [
      { highway: "secondary", surface: "asphalt" },
      { highway: "tertiary", surface: "paved" },
      { highway: "unclassified", surface: "asphalt", bicycle: "yes" }
    ];
    for (const tags of tagSets) {
      expect(scoreFartlekCandidate(candidate([tags])).decision).toBe("AUTO_PUBLISH");
    }
  });

  it("allows a primary road with missing surface when smoothness and bicycle access add evidence", () => {
    const candidateWithMissingSurface = candidate([{
      highway: "primary",
      smoothness: "good",
      bicycle: "yes"
    }]);
    const scored = scoreFartlekCandidate(candidateWithMissingSurface);
    expect(scored.decision).toBe("AUTO_PUBLISH");
    expect(calculateRoadCyclingFlowlineDataConfidence(candidateWithMissingSurface)).toBeGreaterThanOrEqual(60);
  });

  it.each([
    [{ highway: "unclassified", surface: "gravel" }, "REJECT_BAD_SURFACE"],
    [{ highway: "tertiary", surface: "dirt" }, "REJECT_BAD_SURFACE"],
    [{ highway: "secondary", surface: "asphalt", bicycle: "no" }, "REJECT_BICYCLE_FORBIDDEN"],
    [{ highway: "primary", surface: "asphalt", access: "private" }, "REJECT_PRIVATE_ACCESS"],
    [{ highway: "unclassified" }, "REJECT_LOW_CONFIDENCE_UNCLASSIFIED"],
    [{ highway: "primary", surface: "asphalt", smoothness: "very_bad" }, "REJECT_BAD_SMOOTHNESS"]
  ])("hard-rejects invalid tags with reason %s", (tags, reason) => {
    const scored = scoreFartlekCandidate(candidate([tags]));
    expect(scored.decision).toBe("REJECT");
    expect(scored.rejectionReason).toBe(reason);
  });

  it("rejects destination access except when bicycle access is explicitly general", () => {
    expect(isRoadCyclingAccessible({ highway: "tertiary", access: "destination" })).toMatchObject({
      allowed: false,
      reason: "REJECT_DESTINATION_ACCESS"
    });
    expect(isRoadCyclingAccessible({
      highway: "tertiary",
      access: "destination",
      bicycle: "yes"
    }).allowed).toBe(true);
    expect(scoreFartlekCandidate(candidate([{
      highway: "secondary",
      surface: "asphalt",
      access: "destination"
    }])).decision).toBe("REJECT");
    expect(scoreFartlekCandidate(candidate([{
      highway: "secondary",
      surface: "asphalt",
      access: "destination",
      bicycle: "yes"
    }])).decision).toBe("AUTO_PUBLISH");
    expect(isRoadCyclingAccessible({ highway: "secondary", access: "no", bicycle: "yes" }).allowed).toBe(false);
  });

  it("rejects bicycle=use_sidepath on roads but does not apply that rejection to a cycleway", () => {
    expect(scoreFartlekCandidate(candidate([{
      highway: "primary",
      surface: "asphalt",
      bicycle: "use_sidepath"
    }])).rejectionReason).toBe("REJECT_BICYCLE_USE_SIDEPATH");
    expect(isRoadCyclingAccessible({ highway: "cycleway", bicycle: "use_sidepath" }).allowed).toBe(true);
  });

  it("requires sealed-surface evidence on dedicated cycleways", () => {
    expect(scoreFartlekCandidate(candidate([{
      highway: "cycleway",
      surface: "asphalt",
      bicycle: "designated"
    }])).decision).toBe("AUTO_PUBLISH");
    expect(scoreFartlekCandidate(candidate([{
      highway: "cycleway",
      bicycle: "designated"
    }])).rejectionReason).toBe("REJECT_CYCLEWAY_SURFACE_EVIDENCE");
  });

  it("treats high maxspeed as a soft score penalty", () => {
    const lowSpeed = scoreFartlekCandidate(candidate([{
      highway: "secondary",
      surface: "asphalt",
      smoothness: "good",
      bicycle: "yes",
      maxspeed: "50"
    }]));
    const highSpeed = scoreFartlekCandidate(candidate([{
      highway: "secondary",
      surface: "asphalt",
      smoothness: "good",
      bicycle: "yes",
      maxspeed: "100"
    }]));
    expect(highSpeed.decision).toBe("AUTO_PUBLISH");
    expect(highSpeed.suitabilityScore).toBeLessThan(lowSpeed.suitabilityScore);
  });

  it("allows only minor link connectors and never publishes below the quality/confidence floor", () => {
    expect(scoreFartlekCandidate(candidate([{
      highway: "secondary_link",
      surface: "asphalt",
      bicycle: "yes"
    }])).rejectionReason).toBe("REJECT_LINK_STANDALONE");
    expect(scoreFartlekCandidate(candidate([
      { highway: "secondary", surface: "asphalt", bicycle: "yes" },
      { highway: "secondary_link", surface: "asphalt", bicycle: "yes" }
    ], { linkLengthMeters: 200 })).decision).toBe("AUTO_PUBLISH");
    expect(scoreFartlekCandidate(candidate([
      { highway: "secondary", surface: "asphalt", bicycle: "yes" },
      { highway: "secondary_link", surface: "asphalt", bicycle: "yes" }
    ], { linkLengthMeters: 400 })).rejectionReason).toBe("REJECT_LINK_DOMINATED");
    expect(scoreFartlekCandidate(candidate([
      { highway: "secondary", surface: "asphalt", bicycle: "yes" },
      { highway: "secondary_link", surface: "asphalt", bicycle: "yes" }
    ], { lengthMeters: 1_000, linkLengthMeters: 250 })).rejectionReason).toBe("REJECT_LINK_DOMINATED");
    expect(shouldPublishRoadCyclingFlowline({
      qualityScore: 100,
      dataConfidence: 69
    })).toBe(false);
    expect(shouldPublishRoadCyclingFlowline({
      qualityScore: 79,
      dataConfidence: 100
    })).toBe(false);
    expect(shouldPublishRoadCyclingFlowline({
      qualityScore: 80,
      dataConfidence: 70
    })).toBe(true);
  });

  it("rejects unsupported highway classes even when manually supplied", () => {
    expect(scoreFartlekCandidate(candidate([{
      highway: "motorway",
      surface: "asphalt",
      bicycle: "yes"
    }])).rejectionReason).toBe("REJECT_UNSUITABLE_HIGHWAY");
  });
});
