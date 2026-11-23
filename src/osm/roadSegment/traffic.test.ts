import { describe, expect, it } from "vitest";
import type { FartlekCandidate } from "../fartlekModel.js";
import { scoreFartlekCandidate } from "../fartlekScore.js";
import { calculateRoadCyclingFlowlineQuality, shouldPublishRoadCyclingFlowline } from "../roadCyclingFlowlineQuality.js";
import { evaluateRoadCyclingEligibility } from "./eligibility.js";
import {
  evaluateRoadCyclingTrafficComfort,
  hasStrongCyclingComfortEvidence,
  numericMaxspeed,
  roadSpeed
} from "./traffic.js";

const candidate = (tagsBySegment: Record<string, string>[]): FartlekCandidate => ({
  id: "traffic-test", name: "Quiet Road", coordinates: [[8, 48], [8.04, 48]],
  lengthMeters: 3_000, sourceWayIds: ["1"], candidateGenerationVersion: "test",
  junctionCount: 0, trafficControlCount: 0, hasClearBoundaries: true,
  mostlyNonUrban: true, tagsBySegment
});

const comfortable = {
  highway: "tertiary", surface: "asphalt", smoothness: "good",
  bicycle: "yes", maxspeed: "50",
  "cycleway:both": "lane", "cycleway:both:lane": "exclusive"
};

describe("explicit speed normalization", () => {
  it.each([["50", 50], ["50 km/h", 50], ["50 kmh", 50], ["30 mph", 48.28032]])(
    "parses %s without assuming country speed defaults", (raw, expected) => {
      expect(numericMaxspeed(raw)).toBeCloseTo(expected);
    }
  );

  it.each(["DE:urban", "signals", "walk", "50;100", "-1", "NaN", "Infinity", "50 @ (wet)", ""])(
    "keeps unsupported %s unknown", (raw) => expect(roadSpeed({ maxspeed: raw }).kind).toBe("unknown")
  );

  it("uses the worst known directional limit and does not conceal it with unknown data", () => {
    expect(roadSpeed({ maxspeed: "30", "maxspeed:forward": "80", "maxspeed:backward": "signals" }))
      .toEqual({ kind: "known", kmh: 80 });
    expect(roadSpeed({ maxspeed: "30", "maxspeed:conditional": "60 @ (22:00-06:00)" }).kind).toBe("unknown");
    expect(roadSpeed({ maxspeed: "30", "maxspeed:backward": "none" }).kind).toBe("unlimited");
    expect(roadSpeed({ "maxspeed:forward": "40", "maxspeed:backward": "50" })).toEqual({ kind: "known", kmh: 50 });
    expect(roadSpeed({ "maxspeed:forward": "50" }).kind).toBe("unknown");
    expect(roadSpeed({ "maxspeed:forward": "50", oneway: "yes" })).toEqual({ kind: "known", kmh: 50 });
  });
});

describe("publication-only motor-road comfort", () => {
  it.each(["70", "100", "45 mph", "none"])("rejects %s even with otherwise perfect evidence", (maxspeed) => {
    const c = candidate([{ ...comfortable, maxspeed }]);
    const scored = scoreFartlekCandidate(c);
    expect(scored.rejectionReason).toBe("REJECT_HIGH_SPEED_MOTOR_ROAD");
    expect(evaluateRoadCyclingEligibility(c).eligible).toBe(true);
    expect(scored.scores?.endurance).toBeGreaterThan(0);
    expect(scored.scores?.explore).toBeGreaterThan(0);
    expect(scored.scores?.roadQuality).toBeGreaterThan(0);
  });

  it("requires actual comfort evidence throughout the 60-69 band", () => {
    expect(scoreFartlekCandidate(candidate([{ ...comfortable, maxspeed: "69" }])).decision).toBe("AUTO_PUBLISH");
    expect(scoreFartlekCandidate(candidate([{ ...comfortable, maxspeed: "60", "cycleway:both:lane": "advisory" }]))
      .rejectionReason).toBe("REJECT_60_KMH_TRAFFIC_COMFORT");
    const low = scoreFartlekCandidate(candidate([comfortable]));
    const high = scoreFartlekCandidate(candidate([{ ...comfortable, maxspeed: "60" }]));
    expect(low.suitabilityScore - high.suitabilityScore).toBeGreaterThanOrEqual(12);
  });

  it("does not average away a dangerous way or minor link connector", () => {
    const c = candidate([comfortable, { ...comfortable, highway: "tertiary_link", maxspeed: "100" }]);
    c.linkLengthMeters = 10;
    expect(scoreFartlekCandidate(c).rejectionReason).toBe("REJECT_HIGH_SPEED_MOTOR_ROAD");
    expect(scoreFartlekCandidate(candidate([comfortable, { ...comfortable, maxspeed: "60", "cycleway:both": "no" }]))
      .rejectionReason).toBe("REJECT_60_KMH_TRAFFIC_COMFORT");
  });

  it("keeps only the explicit low-speed primary exception", () => {
    expect(scoreFartlekCandidate(candidate([{ ...comfortable, highway: "primary" }])).decision).toBe("AUTO_PUBLISH");
    for (const overrides of [
      { maxspeed: "" }, { maxspeed: "60" }, { smoothness: "" }, { surface: "paved" },
      { "cycleway:both": "separate" }, { "cycleway:both": "track" }
    ]) {
      expect(scoreFartlekCandidate(candidate([{ ...comfortable, highway: "primary", ...overrides }]))
        .rejectionReason).toBe("REJECT_PRIMARY_TRAFFIC_COMFORT");
    }
  });

  it("does not mistake permissions, advisory lanes or ambiguous shoulders for comfort", () => {
    expect(hasStrongCyclingComfortEvidence({ ...comfortable, "cycleway:both:lane": "" })).toBe(false);
    expect(hasStrongCyclingComfortEvidence({ ...comfortable, "cycleway:both": "no", shoulder: "yes" })).toBe(false);
    expect(hasStrongCyclingComfortEvidence({
      ...comfortable, "cycleway:both": "no", shoulder: "both", "shoulder:surface": "asphalt", "shoulder:width": "1.5 m"
    })).toBe(true);
    expect(hasStrongCyclingComfortEvidence({
      ...comfortable, "cycleway:both": "no", shoulder: "both", "shoulder:surface": "asphalt", "shoulder:width": "1.0"
    })).toBe(false);
  });

  it("requires bilateral lane evidence unless the carriageway is explicitly one-way", () => {
    const tags = { ...comfortable, "cycleway:both": "no", "cycleway:right": "lane", "cycleway:right:lane": "exclusive" };
    expect(hasStrongCyclingComfortEvidence(tags)).toBe(false);
    expect(hasStrongCyclingComfortEvidence({ ...tags, oneway: "yes" })).toBe(true);
  });

  it("blocks unknown secondary speeds and applies class-specific tertiary/unclassified uncertainty", () => {
    expect(scoreFartlekCandidate(candidate([{ ...comfortable, highway: "secondary", maxspeed: "" }]))
      .rejectionReason).toBe("REJECT_SECONDARY_UNKNOWN_SPEED");
    const tertiary = calculateRoadCyclingFlowlineQuality(candidate([{ ...comfortable, maxspeed: "" }]));
    const unclassified = calculateRoadCyclingFlowlineQuality(candidate([{ ...comfortable, highway: "unclassified", maxspeed: "" }]));
    expect(tertiary.dataConfidence).toBeLessThan(unclassified.dataConfidence);
    expect(tertiary.trafficComfort.qualityPenalty).toBeGreaterThan(unclassified.trafficComfort.qualityPenalty);
    expect(shouldPublishRoadCyclingFlowline(tertiary)).toBe(true);
    expect(shouldPublishRoadCyclingFlowline(unclassified)).toBe(true);
  });

  it("penalizes explicit multilane carriageways without inventing traffic volume", () => {
    expect(evaluateRoadCyclingTrafficComfort(candidate([{ ...comfortable, lanes: "4" }])).qualityPenalty).toBe(5);
    expect(evaluateRoadCyclingTrafficComfort(candidate([{ ...comfortable, lanes: "unknown" }])).qualityPenalty).toBe(0);
  });

  it.each(["", "100", "none"])("does not apply motor-road speed policy to a separate paved cycleway (%s)", (maxspeed) => {
    expect(scoreFartlekCandidate(candidate([{ highway: "cycleway", surface: "asphalt", bicycle: "designated", maxspeed }]))
      .decision).toBe("AUTO_PUBLISH");
  });
});
