import type { PlayerProgress, ProgressionResult } from "./domain.js";

const XP_PER_LEVEL = 100;

const assertNonNegativeFinite = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite, non-negative number.`);
  }
};

export const getTotalXpRequiredForLevel = (level: number): number => {
  if (!Number.isSafeInteger(level) || level < 1) {
    throw new RangeError("level must be a positive safe integer.");
  }
  return XP_PER_LEVEL * (level - 1) * level / 2;
};

export const getXpRequiredForLevel = (level: number): number => {
  if (!Number.isSafeInteger(level) || level < 1) {
    throw new RangeError("level must be a positive safe integer.");
  }
  return XP_PER_LEVEL * level;
};

export const getLevelForXp = (totalXp: number): number => {
  assertNonNegativeFinite(totalXp, "totalXp");
  let level = Math.max(1, Math.floor((1 + Math.sqrt(1 + 8 * totalXp / XP_PER_LEVEL)) / 2));
  while (getTotalXpRequiredForLevel(level + 1) <= totalXp) level += 1;
  while (getTotalXpRequiredForLevel(level) > totalXp) level -= 1;
  return level;
};

export const getLevelProgress = (totalXp: number): PlayerProgress => {
  assertNonNegativeFinite(totalXp, "totalXp");
  const level = getLevelForXp(totalXp);
  const currentLevelXp = totalXp - getTotalXpRequiredForLevel(level);
  const nextLevelXp = getXpRequiredForLevel(level);
  return {
    totalXp,
    level,
    currentLevelXp,
    nextLevelXp,
    progressToNextLevel: currentLevelXp / nextLevelXp,
    remainingXp: Math.max(0, nextLevelXp - currentLevelXp),
    progressPercent: Math.max(0, Math.min(100, (currentLevelXp / nextLevelXp) * 100))
  };
};

export const applyActivityXp = (previousTotalXp: number, xpEarned: number): ProgressionResult => {
  assertNonNegativeFinite(previousTotalXp, "previousTotalXp");
  assertNonNegativeFinite(xpEarned, "xpEarned");
  const newTotalXp = previousTotalXp + xpEarned;
  assertNonNegativeFinite(newTotalXp, "newTotalXp");
  const previousLevel = getLevelForXp(previousTotalXp);
  const newLevel = getLevelForXp(newTotalXp);
  return {
    previousTotalXp,
    xpEarned,
    newTotalXp,
    previousLevel,
    newLevel,
    levelsGained: newLevel - previousLevel
  };
};
