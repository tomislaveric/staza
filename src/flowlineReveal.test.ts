import { describe, expect, it } from "vitest";
import { selectFlowlinesToReveal } from "./flowlineReveal.js";

describe("selectFlowlinesToReveal", () => {
  const candidates = [
    { id: "c", flowScore: 70 },
    { id: "a", flowScore: 90 },
    { id: "b", flowScore: 90 },
    { id: "d" },
    { id: "e", flowScore: 95 }
  ];

  it("picks the best unrevealed Flowlines, ties by id", () => {
    expect(selectFlowlinesToReveal(candidates, new Set(["e"]), 3).map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("reveals the next best on repeated exploration and nothing once all are revealed", () => {
    expect(selectFlowlinesToReveal(candidates, new Set(["e", "a", "b", "c"]), 3).map((item) => item.id)).toEqual(["d"]);
    expect(selectFlowlinesToReveal(candidates, new Set(candidates.map((item) => item.id)))).toEqual([]);
  });
});
