import { describe, expect, it } from "vitest";
import { ActivityCard, activitiesViewModel, formatActivityDate, formatActivityDuration } from "./activities-page.js";

describe("Activities data transformation", () => {
  const activities = [
    {
      id: "newest", startedAt: "2026-09-26T12:00:00.000Z", distanceMeters: 5_400,
      durationSeconds: 3_960, xpEarned: 40, collectedCount: 2, hasVideo: true
    },
    {
      id: "older", startedAt: "2026-09-25T12:00:00.000Z",
      xpEarned: 10, collectedCount: 1, hasVideo: false
    }
  ];

  it("preserves repository ordering while deriving compact history totals", () => {
    expect(activitiesViewModel(activities)).toMatchObject({
      activities,
      stats: { count: 2, distanceMeters: 5_400, xp: 50, collected: 3 }
    });
  });

  it("formats persisted activity metadata and missing values explicitly", () => {
    expect(formatActivityDate(activities[0].startedAt)).toBe("SAT, SEP 26");
    expect(formatActivityDuration(activities[0].durationSeconds)).toBe("1h 6m");
    expect(formatActivityDuration(undefined)).toBe("Duration unavailable");
  });

  it("shows the static route preview and collectible dots for a detailed activity", () => {
    const activity = {
      ...activities[0],
      events: [{ sourceId: "castle", collectible: { name: "Castle Gate" } }],
      replay: {
        activity: {
          route: [{ latitude: 48, longitude: 11, timestampMs: 0 }, { latitude: 48.1, longitude: 11.1, timestampMs: 1_000 }]
        },
        activityResult: { collectibles: [], events: [] }
      }
    };

    expect(ActivityCard(activity)).toContain('class="activity-replay-still activity-card-replay"');
    expect(ActivityCard(activity)).toContain('data-replay-still');
    expect(ActivityCard(activity)).not.toContain("rarity");
    expect(ActivityCard(activity)).not.toContain("Castle Gate");
    expect(ActivityCard(activity)).not.toContain("activity-found");
  });
});
