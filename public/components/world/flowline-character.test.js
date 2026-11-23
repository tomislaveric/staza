import { describe, expect, it } from "vitest";
import { classifyFlowline as classifyServer } from "../../../src/flowlineCharacter.ts";
import { classifyFlowline, flowlineCharacter } from "./flowline-character.js";

describe("web character compatibility", () => {
  it("matches the canonical policy across boundaries, missing data and precedence", () => {
    for (const lengthMeters of [undefined, 0, -1, NaN, Infinity, 4999.99, 5000, 5000.01]) {
      for (const flowScore of [undefined, NaN, Infinity, 82, 82.01, 100, 101]) {
        for (const enduranceScore of [64, 65, 100]) {
          for (const exploreScore of [64, 65, 100]) {
            const scores = { lengthMeters, flowScore, enduranceScore, exploreScore };
            expect(classifyFlowline(scores)).toEqual(classifyServer(scores));
          }
        }
      }
    }
  });

  it("reclassifies old/missing payloads but respects explicit neutral and current policy", () => {
    const scores = { lengthMeters: 6000, flowScore: 95, enduranceScore: 65 };
    expect(flowlineCharacter(scores).primary).toBe("endurance");
    expect(flowlineCharacter({ ...scores, character: { primary: "flow", tags: ["flow", "explore"] } }).primary).toBe("endurance");
    const neutral = { primary: null, tags: [] };
    expect(flowlineCharacter({ ...scores, character: neutral })).toBe(neutral);
    const current = { primary: "explore", tags: ["explore"], policyVersion: 2 };
    expect(flowlineCharacter({ ...scores, character: current })).toBe(current);
  });
});
