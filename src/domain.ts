export type CollectibleType = "coin" | "landmark" | "mountain_pass";
export type CollectibleRarity = "common" | "rare" | "epic";
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
  rarity?: CollectibleRarity;
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
  rareFinds: number;
  epicFinds: number;
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
    rarity?: CollectibleRarity;
  };
  value: number;
  latitude: number;
  longitude: number;
  activityTimestamp: number;
  videoSecond?: number;
}

export interface NearMissCollectible {
  collectibleId: string;
  name: string;
  value: number;
  rarity?: CollectibleRarity;
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
}

export interface ActivityResult {
  activityId: string;
  distance?: number;
  duration?: number;
  collectedCount: number;
  totalPoints: number;
  collectibles: Collectible[];
  events: GameEvent[];
  nearMisses: NearMissCollectible[];
  fartlekCompletions: FartlekCompletionDraft[];
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
}

export interface ProgressLevel {
  level: number;
  totalXpRequired: number;
}

export interface ProgressLifetimeStats {
  distanceMeters: number;
  totalCollectibles: number;
  rareOrBetterCollectibles: number;
}

export interface ProgressDashboard {
  progress: PlayerProgress;
  lifetime: ProgressLifetimeStats;
  levels: ProgressLevel[];
  recentActivities: ActivityHistoryItem[];
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
  startedAt: string;
  distanceMeters?: number;
  durationSeconds?: number;
  xpEarned: number;
  collectedCount: number;
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
  value: number;
  latitude: number;
  longitude: number;
  activityTimestamp: number;
}

export interface ReplaySnapshot {
  version: 1;
  activity: Activity;
  activityResult: ActivityResult;
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
  quests: QuestSummary[];
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
