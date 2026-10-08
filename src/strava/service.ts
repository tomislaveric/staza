import { randomUUID } from "node:crypto";
import { STRAVA_ONBOARDING_IMPORT_LIMIT, type ActivityImportResult, type ActivityType, type PersistedActivity } from "../domain.js";
import type { CanonicalActivityProcessor } from "../activityProcessing.js";
import type { ActivityRepository } from "../persistence/activityRepository.js";
import type {
  StravaConnectionRepository,
  StravaConnectionStatus,
  StravaReturnLocale
} from "../persistence/stravaConnectionRepository.js";
import { STRAVA_SCOPE, type StravaActivitySummary, type StravaClient } from "./client.js";
import { StravaError } from "./errors.js";
import { mapStravaSportType, normalizeStravaActivity } from "./normalize.js";

export type StravaCallbackOutcome = "connected" | "denied" | "missing_scope" | "invalid_state" | "error";

export interface StravaCallbackQuery {
  state?: unknown;
  code?: unknown;
  scope?: unknown;
  error?: unknown;
}

/** Transient, display-only summary. It is never stored for activities the user does not import. */
export interface StravaRecentActivity {
  id: string;
  name: string;
  sportType?: string;
  activityType: ActivityType;
  startDate?: string;
  distanceMeters?: number;
  movingTimeSeconds?: number;
  hasRoute: boolean;
  beforeJourneyStart: boolean;
  importedActivityId?: string;
}

export interface StravaRecentActivities {
  activities: StravaRecentActivity[];
  limit: number;
  journeyStartedAt?: string;
}

const STRAVA_ACTIVITY_ID = /^[1-9][0-9]{0,19}$/;
/** One fixed first page, large enough to still find GPS activities among indoor or manual ones. */
const RECENT_FETCH_SIZE = 30;

const hasRoute = (summary: StravaActivitySummary): boolean =>
  summary.manual !== true && (
    (typeof summary.map?.summary_polyline === "string" && summary.map.summary_polyline.length > 0)
    || (Array.isArray(summary.start_latlng) && summary.start_latlng.length === 2)
  );

const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

export class StravaService {
  constructor(
    private readonly client: StravaClient,
    private readonly connections: StravaConnectionRepository,
    private readonly activities: ActivityRepository,
    private readonly process: CanonicalActivityProcessor,
    private readonly recentLimit: number
  ) {}

  get limit(): number {
    return this.recentLimit;
  }

  async startAuthorization(playerId: string, sessionId: string, locale: StravaReturnLocale): Promise<string> {
    return this.client.authorizationUrl(await this.connections.createOAuthState(playerId, sessionId, locale));
  }

  /** Validates the returning session and state before exchanging the authorization code. */
  async completeAuthorization(
    user: { playerId: string; sessionId: string } | undefined,
    query: StravaCallbackQuery
  ): Promise<{ outcome: StravaCallbackOutcome; locale: StravaReturnLocale }> {
    if (!user || typeof query.state !== "string" || query.state.length === 0 || query.state.length > 200) {
      return { outcome: "invalid_state", locale: "en" };
    }
    const state = await this.connections.consumeOAuthState(query.state, user.playerId, user.sessionId);
    if (!state) return { outcome: "invalid_state", locale: "en" };
    const { locale } = state;
    if (query.error !== undefined) return { outcome: "denied", locale };
    const scopes = typeof query.scope === "string" ? query.scope.split(",").map((scope) => scope.trim()) : [];
    if (!scopes.includes(STRAVA_SCOPE)) return { outcome: "missing_scope", locale };
    if (typeof query.code !== "string" || query.code.length === 0 || query.code.length > 200) return { outcome: "error", locale };
    try {
      const authorization = await this.client.exchangeCode(query.code);
      await this.connections.saveConnection(user.playerId, authorization, STRAVA_SCOPE);
      return { outcome: "connected", locale };
    } catch (error) {
      console.error("Strava authorization failed:", error instanceof StravaError ? error.code : "unexpected error");
      return { outcome: "error", locale };
    }
  }

  status(playerId: string): Promise<StravaConnectionStatus> {
    return this.connections.getStatus(playerId);
  }

  async listRecent(playerId: string): Promise<StravaRecentActivities> {
    const summaries = await this.withAccessToken(playerId, (token) => this.recentWithRoute(token));
    const ids = summaries.map((summary) => String(summary.id));
    const [imported, journeyStartedAt, activityCount] = await Promise.all([
      this.activities.listActivityIdsByImportKeys(playerId, "strava", ids),
      this.activities.getJourneyStartedAt(playerId),
      this.activities.getActivityCount(playerId)
    ]);
    const isStravaOnboarding = activityCount < STRAVA_ONBOARDING_IMPORT_LIMIT;
    return {
      limit: this.recentLimit,
      ...(journeyStartedAt ? { journeyStartedAt: journeyStartedAt.toISOString() } : {}),
      activities: summaries.map((summary) => {
        const id = String(summary.id);
        const startMs = typeof summary.start_date === "string" ? Date.parse(summary.start_date) : Number.NaN;
        const importedActivityId = imported.get(id);
        const distanceMeters = finite(summary.distance);
        const movingTimeSeconds = finite(summary.moving_time);
        return {
          id,
          name: typeof summary.name === "string" && summary.name.trim() ? summary.name.trim().slice(0, 200) : "Strava activity",
          ...(typeof summary.sport_type === "string" ? { sportType: summary.sport_type } : {}),
          activityType: mapStravaSportType(summary.sport_type, summary.type),
          ...(Number.isFinite(startMs) ? { startDate: new Date(startMs).toISOString() } : {}),
          ...(distanceMeters === undefined ? {} : { distanceMeters }),
          ...(movingTimeSeconds === undefined ? {} : { movingTimeSeconds }),
          hasRoute: hasRoute(summary),
          beforeJourneyStart: Boolean(
            !isStravaOnboarding
            && journeyStartedAt
            && Number.isFinite(startMs)
            && startMs < journeyStartedAt.getTime()
          ),
          ...(importedActivityId ? { importedActivityId } : {})
        };
      })
    };
  }

  /**
   * Imports exactly one activity chosen from the fixed recent list. An existing import of the same
   * Strava activity is returned unchanged before any provider request is made.
   */
  async importActivity(
    playerId: string,
    rawActivityId: string,
    attachUrls: (activity: PersistedActivity) => PersistedActivity = (activity) => activity
  ): Promise<ActivityImportResult> {
    if (!STRAVA_ACTIVITY_ID.test(rawActivityId)) throw new StravaError("invalid_activity_id");
    const existing = await this.activities.getActivityByImportKey(playerId, rawActivityId, "strava");
    if (existing) return { activity: attachUrls(existing), inserted: false };

    const { summary, streams } = await this.withAccessToken(playerId, async (token) => {
      const recent = await this.recentWithRoute(token);
      const selected = recent.find((candidate) => String(candidate.id) === rawActivityId);
      if (!selected) throw new StravaError("activity_not_found");
      return { summary: selected, streams: await this.client.getActivityStreams(token, rawActivityId) };
    });
    const activity = normalizeStravaActivity(randomUUID(), summary, streams);
    const { result } = await this.process(activity);
    const persisted = await this.activities.persistCompletedActivity(playerId, activity, result, rawActivityId);
    return { activity: attachUrls(persisted.activity), inserted: persisted.inserted };
  }

  /** The newest activities with GPS data, taken from a single first-page request. */
  private async recentWithRoute(token: string): Promise<StravaActivitySummary[]> {
    const recent = await this.client.listRecentActivities(token, Math.max(RECENT_FETCH_SIZE, this.recentLimit));
    return recent.filter(hasRoute).slice(0, this.recentLimit);
  }

  /** Removes local credentials first, then attempts remote deauthorization once. */
  async disconnect(playerId: string): Promise<{ disconnected: true; remoteRevoked: boolean }> {
    const { accessToken } = await this.connections.deleteConnection(playerId);
    const remoteRevoked = accessToken ? await this.client.deauthorize(accessToken) : false;
    return { disconnected: true, remoteRevoked };
  }

  private async withAccessToken<T>(playerId: string, operation: (accessToken: string) => Promise<T>): Promise<T> {
    const token = await this.connections.getAccessToken(playerId, (refreshToken) => this.client.refresh(refreshToken));
    try {
      return await operation(token);
    } catch (error) {
      if (error instanceof StravaError && error.code === "reconnect_required") await this.connections.markReconnectRequired(playerId);
      throw error;
    }
  }
}
