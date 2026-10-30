import type { ActivityHistoryItem, ActivityHistorySummary, ProgressDashboardActivity } from "./domain.js";

export const summarizeActivities = (activities: ActivityHistoryItem[]): ActivityHistorySummary => ({
  count: activities.length,
  distanceMeters: activities.reduce((total, activity) => total + (activity.distanceMeters ?? 0), 0),
  xp: activities.reduce((total, activity) => total + activity.xpEarned, 0),
  collected: activities.reduce((total, activity) => total + activity.collectedCount, 0),
  flowlines: activities.reduce((total, activity) => total + activity.flowlineCount, 0)
});

export const withXpPercentOfBest = (activities: ActivityHistoryItem[]): ProgressDashboardActivity[] => {
  const best = Math.max(0, ...activities.map((activity) => activity.xpEarned));
  return activities.map((activity) => ({
    ...activity,
    xpPercentOfBest: best > 0 ? Math.max(0, Math.min(100, (activity.xpEarned / best) * 100)) : 0
  }));
};
