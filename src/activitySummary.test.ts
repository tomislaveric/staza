import { describe, expect, it } from "vitest";
import { summarizeActivities, withXpPercentOfBest } from "./activitySummary.js";
import type { ActivityHistoryItem } from "./domain.js";

const activity = (overrides: Partial<ActivityHistoryItem>): ActivityHistoryItem => ({
  id: "a", type: "ride", title: "Ride", startedAt: "2026-01-01T00:00:00.000Z",
  xpEarned: 0, collectedCount: 0, revisitCount: 0, flowlineCount: 0, hasVideo: false, ...overrides
} as ActivityHistoryItem);

describe("activity summaries", () => {
  it("totals history and treats missing distance as zero", () => {
    expect(summarizeActivities([
      activity({ distanceMeters: 5_400, xpEarned: 40, collectedCount: 2, flowlineCount: 1 }),
      activity({ xpEarned: 10, collectedCount: 1 })
    ])).toEqual({ count: 2, distanceMeters: 5_400, xp: 50, collected: 3, flowlines: 1 });
    expect(summarizeActivities([])).toEqual({ count: 0, distanceMeters: 0, xp: 0, collected: 0, flowlines: 0 });
  });

  it("scales activity XP against the best activity", () => {
    expect(withXpPercentOfBest([activity({ xpEarned: 40 }), activity({ xpEarned: 10 })]).map((item) => item.xpPercentOfBest)).toEqual([100, 25]);
    expect(withXpPercentOfBest([activity({ xpEarned: 0 })])[0].xpPercentOfBest).toBe(0);
  });
});
