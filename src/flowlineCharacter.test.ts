import { describe, expect, it } from "vitest";
import { classifyFlowline, primaryScore } from "./flowlineCharacter.js";

describe("classifyFlowline", () => {
  it("tags every qualifying character, strongest first", () => {
    expect(classifyFlowline({ flowScore: 84, enduranceScore: 90, exploreScore: 40 })).toEqual({ primary: "endurance", tags: ["endurance", "flow"] });
  });

  it("falls back to the highest score when nothing qualifies", () => {
    expect(classifyFlowline({ flowScore: 30, enduranceScore: 20, exploreScore: 50 })).toEqual({ primary: "explore", tags: ["explore"] });
  });

  it("treats unscored Flowlines as flow", () => {
    expect(classifyFlowline({})).toEqual({ primary: "flow", tags: ["flow"] });
    expect(primaryScore({})).toBe(0);
  });

  it("returns the primary character's score", () => {
    expect(primaryScore({ flowScore: 60, enduranceScore: 75 })).toBe(75);
  });
});
