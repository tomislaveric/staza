import { describe, expect, it } from "vitest";
import type { FartlekCandidate } from "../fartlekModel.js";
import {
  evaluateRoadCyclingEligibility,
  isRoadCyclingAccessible,
  roadCyclingCompatibilityKey
} from "./eligibility.js";

const candidate = (tags: Record<string, string>[], overrides: Partial<FartlekCandidate> = {}): FartlekCandidate => ({
  id: "eligibility-test",
  name: "Road",
  coordinates: [[8, 48], [8.04, 48]],
  lengthMeters: 3_000,
  sourceWayIds: ["way-1"],
  candidateGenerationVersion: "test-v1",
  junctionCount: 0,
  trafficControlCount: 0,
  tagsBySegment: tags,
  hasClearBoundaries: true,
  mostlyNonUrban: true,
  ...overrides
});

describe("road cycling eligibility", () => {
  it("accepts a plain asphalt secondary road", () => {
    const result = evaluateRoadCyclingEligibility(candidate([{ highway: "secondary", surface: "asphalt" }]));
    expect(result).toEqual({ eligible: true, reasons: [] });
  });

  it.each([
    [{ highway: "secondary", surface: "gravel" }, "REJECT_BAD_SURFACE"],
    [{ highway: "secondary", surface: "asphalt", bicycle: "no" }, "REJECT_BICYCLE_FORBIDDEN"],
    [{ highway: "secondary", surface: "asphalt", access: "private" }, "REJECT_PRIVATE_ACCESS"],
    [{ highway: "path", surface: "asphalt" }, "REJECT_UNSUITABLE_HIGHWAY"]
  ])("rejects %o with the expected reason", (tags, reason) => {
    const result = evaluateRoadCyclingEligibility(candidate([tags as Record<string, string>]));
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain(reason);
  });

  it("rejects segments shorter than the minimum length", () => {
    const result = evaluateRoadCyclingEligibility(
      candidate([{ highway: "secondary", surface: "asphalt" }], { lengthMeters: 100 })
    );
    expect(result.reasons).toContain("REJECT_TOO_SHORT");
  });

  it("surfaces a typed access reason from isRoadCyclingAccessible", () => {
    expect(isRoadCyclingAccessible({ access: "destination", bicycle: "yes" })).toMatchObject({ allowed: true });
    expect(isRoadCyclingAccessible({ bicycle: "no" })).toMatchObject({
      allowed: false,
      reason: "REJECT_BICYCLE_FORBIDDEN"
    });
  });

  it("treats a material surface change as a different compatibility key", () => {
    expect(roadCyclingCompatibilityKey({ highway: "secondary", surface: "asphalt" }))
      .not.toBe(roadCyclingCompatibilityKey({ highway: "secondary", surface: "gravel" }));
  });
});
