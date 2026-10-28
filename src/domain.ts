export type CollectibleType = "coin" | "landmark" | "mountain_pass";
export type CollectibleStatus = "published" | "archived";
export type CollectibleCategory = "viewpoint" | "peak" | "castle" | "waterfall" | "place" | "mountain_pass";

export interface CollectibleSource {
  sourceType: string;
  sourceExternalId: string;
  sourceUrl?: string;
  sourceAttribution?: string;
}

export interface Collectible {
  id: string;
  name: string;
  type: CollectibleType;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  value: number;
  description?: string;
  elevationMeters?: number;
  status?: CollectibleStatus;
  source?: CollectibleSource;
  primaryCategory?: CollectibleCategory;
  tags?: string[];
  wikidataQid?: string;
  wikipediaReference?: string;
  enrichmentMetadata?: Record<string, unknown>;
}

export type WorldCollectibleVisibility = "visible" | "hidden";

export interface WorldCollectible extends Collectible {
  found: boolean;
  visibility: WorldCollectibleVisibility;
}

export interface WorldStats {
  totalCollectibles: number;
  discoveredCount: number;
  remainingCount: number;
}

export interface WorldSnapshot {
  collectibles: WorldCollectible[];
  stats: WorldStats;
}

export interface TrackPoint {
  latitude: number;
  longitude: number;
  timestampMs: number;
}

export interface VideoTimeSample {
  timestampMs: number;
  videoSeconds: number;
}

export interface GameEvent {
  /** @deprecated Compatibility alias for sourceId. */
  id: string;
  type: "collectible_collected";
  sourceId: string;
  collectible: {
    name: string;
    type: CollectibleType;
  };
  value: number;
  latitude: number;
  longitude: number;
  activityTimestamp: number;
  videoSecond?: number;
  /** True when the player already claimed this collectible earlier; a revisit grants no XP. */
  repeat?: boolean;
}

export interface NearMissCollectible {
  collectibleId: string;
  name: string;
  value: number;
  minimumDistanceMeters: number;
}

export interface MappedGameEvent extends GameEvent {
  videoSecond: number;
}

export type ActivityType = "cycling" | "running" | "hiking" | "walking" | "unknown";

export type ActivitySource = "fit" | "strava";


export interface Activity {
  id: string;
  source: ActivitySource;
  type: ActivityType;
  title?: string;
  description?: string;
  startedAt: number;
  endedAt: number;
  route: TrackPoint[];
  distance?: number;
  duration?: number;
  elevationGainM?: number;
}

export type FartlekStatus = "published" | "archived";
export type FartlekTraversalDirection = "a_to_b" | "b_to_a";

export interface FartlekSource {
  sourceType: string;
  sourceExternalId: string;
  sourceAttribution?: string;
}

export interface FartlekGeometry {
  type: "LineString";
  coordinates: [number, number][];
}

/** A linear World challenge completed by traversing the full segment, in either direction (v1). */
export interface Fartlek {
  id: string;
  name: string;
  geometry: FartlekGeometry;
  startLatitude: number;
  startLongitude: number;
  endLatitude: number;
  endLongitude: number;
  lengthMeters: number;
  status: FartlekStatus;
  /** Reserved for future one-way enforcement; always falsy in v1 (bidirectional). */
  directionRestricted?: boolean;
  source: FartlekSource;
  sourceMetadata?: Record<string, unknown>;
  suitabilityScore: number;
  suitabilityReasons: string[];
  mappingConfidence: number;
  /** Flow score (0..100). Equals `suitabilityScore`; the generic model's "flow" expression. */
  flowScore?: number;
  /** Independent road-cycling style scores (0..100) from the generic segment model. */
  enduranceScore?: number;
  exploreScore?: number;
  roadQualityScore?: number;
  /** Data confidence, 0..100 (persisted); equals `mappingConfidence`. */
  dataConfidence?: number;
  /** Integer segment scoring-model version persisted alongside the scores. */
  scoringVersion?: number;
  /** Bumped whenever the source geometry is refreshed; snapshotted onto completions. */
  geometryVersion: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface FartlekCompletionSummary {
  completedAt: string;
  elapsedTimeS: number;
  averageSpeedMps: number;
  maxSpeedMps?: number;
}

/** A Fartlek as rendered in World: a LineString challenge, never a point collectible. */
export interface WorldFartlek {
  id: string;
  name: string;
  geometry: FartlekGeometry;
  lengthMeters: number;
  /** Flow score (0..100); lets the World "high flow" filter work client-side. */
  flowScore?: number;
  status: FartlekStatus;
  source: FartlekSource;
  completed: boolean;
  completionCount: number;
  bestElapsedTimeS?: number;
  latestCompletion?: FartlekCompletionSummary;
}

export interface FartlekCompletion {
  id: string;
  fartlekId: string;
  playerId: string;
  activityId: string;
  completedAt: string;
  elapsedTimeS: number;
  averageSpeedMps: number;
  maxSpeedMps?: number;
  traversalDirection?: FartlekTraversalDirection;
  fartlekLengthMSnapshot: number;
  fartlekGeometryVersionSnapshot: number;
}

/** A not-yet-persisted completion produced by the activity processing pipeline. */
export interface FartlekCompletionDraft {
  fartlekId: string;
  fartlekName: string;
  fartlekGeometry: FartlekGeometry;
  completedAtTimestampMs: number;
  elapsedTimeS: number;
  averageSpeedMps: number;
  maxSpeedMps?: number;
  traversalDirection: FartlekTraversalDirection;
  fartlekLengthMSnapshot: number;
  fartlekGeometryVersionSnapshot: number;
  /** XP this completion awards. */
  xp?: number;
}

export interface ActivityResult {
  activityId: string;
  distance?: number;
  duration?: number;
  /** Collectibles claimed for the first time by this activity. Revisits are counted in `revisitCount`. */
  collectedCount: number;
  /** Collectibles passed again after an earlier claim; they award no XP. */
  revisitCount?: number;
  totalPoints: number;
  distanceXp: number;
  distanceXpRewards: DistanceXpReward[];
  collectibles: Collectible[];
  events: GameEvent[];
  nearMisses: NearMissCollectible[];
  fartlekCompletions: FartlekCompletionDraft[];
}

export interface DistanceXpReward {
  distanceMeters: number;
  xpEarned: number;
  activityTimestampMs: number;
}

export interface PlayerProgress {
  totalXp: number;
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progressToNextLevel: number;
}

export interface PlayerProfileOverview {
  displayName: string;
  progress: PlayerProgress;
  distanceMeters: number;
  activityCount: number;
  flowlineCount: number;
}

export interface ProgressLevel {
  level: number;
  totalXpRequired: number;
  skillPointsAwarded: number;
}

export interface ProgressLifetimeStats {
  distanceMeters: number;
  /** Unique collectibles claimed. */
  totalCollectibles: number;
  /** Unique Flowlines completed. */
  totalFlowlines: number;
}

export interface QuestHistoryEntry {
  id: string;
  kind: "authored" | "exploration";
  title: string;
  chainTitle?: string;
  difficulty: QuestDifficulty;
  xp: number;
  completedAt: string;
  activityId?: string;
}

export interface ProgressDashboard {
  progress: PlayerProgress;
  lifetime: ProgressLifetimeStats;
  levels: ProgressLevel[];
  recentActivities: ActivityHistoryItem[];
  questHistory: QuestHistoryEntry[];
}

export interface ProgressionResult {
  previousTotalXp: number;
  xpEarned: number;
  newTotalXp: number;
  previousLevel: number;
  newLevel: number;
  levelsGained: number;
}

export interface ActivityHistoryItem {
  id: string;
  type: ActivityType;
  title: string;
  startedAt: string;
  distanceMeters?: number;
  durationSeconds?: number;
  xpEarned: number;
  /** Collectibles claimed for the first time (unique claims). */
  collectedCount: number;
  /** Collectibles passed again after an earlier claim. */
  revisitCount: number;
  flowlineCount: number;
  hasVideo: boolean;
}

export interface PersistedActivity extends ActivityHistoryItem {
  events: PersistedActivityEvent[];
  replay?: ReplaySnapshot;
  video?: ActivityVideo;
}

export type ActivityVideoState = "syncing" | "sync_failed" | "no_highlights" | "awaiting_selection" | "rendering" | "succeeded" | "render_failed";

export interface ActivityVideo {
  mediaId: string;
  sourceFilename: string;
  state: ActivityVideoState;
  sourceDuration?: number;
  synchronization?: import("./synchronization.js").SynchronizationSummary;
  events?: MappedGameEvent[];
  selectedSourceIds?: string[];
  render?: import("./video.js").RenderSummary;
  error?: string;
  previewUrl?: string;
  downloadUrl?: string;
}

export interface ActivityImportResult {
  activity: PersistedActivity;
  inserted: boolean;
  videoError?: string;
}

export interface PersistedActivityEvent {
  id: string;
  sourceId: string;
  type: GameEvent["type"];
  collectible: GameEvent["collectible"];
  collectibleCategory?: CollectibleCategory;
  value: number;
  latitude: number;
  longitude: number;
  activityTimestamp: number;
  repeat?: boolean;
}

export type QuestDifficulty = "easy" | "medium" | "hard" | "prestige";

/** One objective of a one-activity quest attempt, with the value the activity reached. */
export interface QuestCriterionResult {
  label: string;
  current: number;
  required: number;
  met: boolean;
  unit?: string;
}

export interface NextQuestSuggestion {
  id: string;
  title: string;
  chainTitle?: string;
  difficulty: QuestDifficulty;
  xp: number;
}

/** What one activity did to a quest attempt: it either completed the quest or failed the attempt. */
export interface QuestOutcome {
  questId: string;
  kind: "authored" | "exploration";
  title: string;
  chainTitle?: string;
  difficulty: QuestDifficulty;
  result: "completed" | "failed";
  /** Bonus XP granted; always 0 for a failed attempt. */
  xp: number;
  criteria: QuestCriterionResult[];
  next?: NextQuestSuggestion;
}

export interface ActivityOutcomeNode {
  id: string;
  name: string;
  cost: number;
}

/** The authoritative "what changed" for one imported activity, frozen at import. */
export interface ActivityOutcome {
  version: 1;
  xp: {
    collectibles: number;
    flowlines: number;
    distance: number;
    quests: number;
    total: number;
  };
  progression: {
    previousTotalXp: number;
    newTotalXp: number;
    previousLevel: number;
    newLevel: number;
    levelsGained: number;
    skillPointsEarned: number;
    unspentSkillPoints: number;
    /** Levels previousLevel..newLevel+1 with their XP thresholds, for animating level-ups. */
    levels: Array<{ level: number; totalXpRequired: number; skillPointsAwarded: number }>;
  };
  unlockableNodes: ActivityOutcomeNode[];
  collectibles: { newCount: number; revisitCount: number };
  flowlines: { completedCount: number; newCount: number };
  quests: QuestOutcome[];
}

export interface ReplaySnapshot {
  version: 1;
  activity: Activity;
  activityResult: ActivityResult;
  outcome?: ActivityOutcome;
}

export interface HudTrackSample {
  latitude: number;
  longitude: number;
  videoSecond: number;
}

export interface HudTimeline {
  version: 1;
  track: HudTrackSample[];
  collectibles: Collectible[];
  events: MappedGameEvent[];
}

export interface WorldQueryDiagnostics {
  totalCollectibles: number;
  relevantCollectibles: number;
}

export type QuestStatus = "draft" | "published";

export interface QuestRoute {
  sourceActivityId?: string;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  distanceMeters?: number;
  activityType?: ActivityType;
}

export interface QuestProgress {
  collected: number;
  total: number;
  ratio: number;
  complete: boolean;
}

export interface QuestSummary {
  id: string;
  title: string;
  description?: string;
  status: QuestStatus;
  createdBy: string;
  isOwner: boolean;
  centerLatitude: number;
  centerLongitude: number;
  collectibleCount: number;
  hasRoute: boolean;
  progress: QuestProgress;
}

export interface QuestDetail extends QuestSummary {
  sourceActivityId?: string;
  collectibles: WorldCollectible[];
  route?: QuestRoute;
}

export interface QuestObjectiveTarget {
  id: string;
  name: string;
}

export type QuestObjective =
  | {
      id: string;
      type: "flowline_rule";
      requiredCount: number;
      targets: QuestObjectiveTarget[];
      minimumLengthMeters?: number;
      minimumAverageSpeedMps?: number;
      sameActivity?: boolean;
    }
  | {
      id: string;
      type: "collectible_count";
      requiredCount: number;
      category: CollectibleCategory;
      targets: QuestObjectiveTarget[];
    }
  | {
      id: string;
      type: "collectible_targets";
      requiredCount: number;
      category?: CollectibleCategory;
      targets: QuestObjectiveTarget[];
    };

export interface QuestObjectiveProgress {
  completed: number;
  required: number;
  complete: boolean;
}

export interface QuestObjectiveTargetProgress extends QuestObjectiveTarget {
  complete: boolean;
  averageSpeedMps?: number;
}

export interface QuestObjectiveState {
  objective: QuestObjective;
  progress: QuestObjectiveProgress;
  targetProgress: QuestObjectiveTargetProgress[];
}

export type QuestInstanceStatus = "active" | "completed" | "failed";

export interface QuestInstance {
  id: string;
  /** Scope key: the confirmed proposal id for explorations, the suggestion id for legacy quests. */
  suggestionId: string;
  templateId: string;
  templateVersion: number;
  title: string;
  description: string;
  recommendedLevel: number;
  status: QuestInstanceStatus;
  difficulty: QuestDifficulty;
  /** Bonus XP granted on completion. */
  rewardXp: number;
  /** Number of attempts started, including the current one. */
  attemptCount: number;
  startedAt: string;
  completedAt?: string;
  failedAt?: string;
  /** The activity that completed or failed the attempt. */
  resolvedActivityId?: string;
  objectives: QuestObjectiveState[];
}

/** The route a player selected when starting an exploration. Planning aid only: never affects progress. */
export interface PlannedRoute {
  id: string;
  questInstanceId: string;
  proposalId: string;
  profile: string;
  routeType: "round_trip" | "point_to_point";
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  distanceM: number;
  durationS: number;
  elevationGainM?: number;
  elevationLossM?: number;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  includedTargetIds: string[];
  plannerVersion: number;
  createdAt: string;
}

export type NewPlannedRoute = Omit<PlannedRoute, "id" | "questInstanceId" | "createdAt">;

export interface QuestInstancesResponse {
  instances: QuestInstance[];
}

export interface QuestDraftSuggestion {
  sourceActivityId: string;
  title: string;
  description: string;
  activityType: ActivityType;
  distanceMeters?: number;
  route: QuestRoute;
  collectibles: WorldCollectible[];
}

export interface QuestInput {
  title: string;
  description?: string;
  sourceActivityId?: string;
  collectibleIds: string[];
}

export interface WorldViewportResponse extends WorldSnapshot {
  truncated: boolean;
  fartleks: WorldFartlek[];
}

export type JobState = "processing" | "awaiting_selection" | "rendering" | "succeeded" | "failed";

export interface Job {
  token: string;
  playerId: string;
  state: JobState;
  createdAt: string;
  updatedAt: string;
  error?: string;
  sourceDuration?: number;
  resultMode?: "activity" | "video";
  activity?: Activity;
  activityResult?: ActivityResult;
  mappedEvents?: MappedGameEvent[];
  outputFile?: string;
  render?: import("./video.js").RenderSummary;
  synchronization?: import("./synchronization.js").SynchronizationSummary;
  world?: WorldQueryDiagnostics;
}
