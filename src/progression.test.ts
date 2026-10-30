import { describe, expect, it } from "vitest";
import {
  applyActivityXp,
  getLevelForXp,
  getLevelProgress,
  getTotalXpRequiredForLevel,
  getXpRequiredForLevel
} from "./progression.js";

describe("progression", () => {
  it("derives the centralized level curve and progress", () => {
    expect(getXpRequiredForLevel(1)).toBe(100);
    expect(getXpRequiredForLevel(4)).toBe(400);
    expect(getTotalXpRequiredForLevel(1)).toBe(0);
    expect(getTotalXpRequiredForLevel(4)).toBe(600);
    expect(getLevelForXp(0)).toBe(1);
    expect(getLevelForXp(99)).toBe(1);
    expect(getLevelForXp(100)).toBe(2);
    expect(getLevelForXp(299)).toBe(2);
    expect(getLevelForXp(300)).toBe(3);
    expect(getLevelProgress(250)).toEqual({
      totalXp: 250,
      level: 2,
      currentLevelXp: 150,
      nextLevelXp: 200,
      progressToNextLevel: 0.75,
      remainingXp: 50,
      progressPercent: 75
    });
  });

  it("handles large totals and applies single and multiple level transitions", () => {
    expect(getLevelForXp(1_000_000_000)).toBeGreaterThan(4_000);
    expect(applyActivityXp(99, 1)).toMatchObject({
      previousTotalXp: 99, xpEarned: 1, newTotalXp: 100, previousLevel: 1, newLevel: 2, levelsGained: 1
    });
    expect(applyActivityXp(0, 600)).toMatchObject({ newTotalXp: 600, previousLevel: 1, newLevel: 4, levelsGained: 3 });
  });

  it("rejects invalid progression inputs", () => {
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => getLevelForXp(value)).toThrow(RangeError);
      expect(() => applyActivityXp(0, value)).toThrow(RangeError);
    }
    expect(() => getXpRequiredForLevel(0)).toThrow(RangeError);
    expect(() => getXpRequiredForLevel(1.5)).toThrow(RangeError);
    expect(() => getTotalXpRequiredForLevel(0)).toThrow(RangeError);
    expect(() => getTotalXpRequiredForLevel(1.5)).toThrow(RangeError);
  });
});
