import { StravaError, type StravaErrorCode } from "./errors.js";

export const STRAVA_SCOPE = "activity:read_all";
const AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
const TOKEN_URL = "https://www.strava.com/oauth/token";
const DEAUTHORIZE_URL = "https://www.strava.com/oauth/deauthorize";
const API_URL = "https://www.strava.com/api/v3";
const REQUEST_TIMEOUT_MS = 15_000;
const SHORT_WINDOW_MS = 15 * 60_000;

export interface StravaClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface StravaTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface StravaAuthorization extends StravaTokenSet {
  athleteId: number;
}

/** The subset of Strava's SummaryActivity that Staza reads. Nothing here is persisted. */
export interface StravaActivitySummary {
  id: number;
  name?: string;
  sport_type?: string;
  type?: string;
  start_date?: string;
  distance?: number;
  moving_time?: number;
  elapsed_time?: number;
  manual?: boolean;
  start_latlng?: number[] | null;
  map?: { summary_polyline?: string | null } | null;
}

export interface StravaStreams {
  latlng?: { data?: unknown };
  time?: { data?: unknown };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const nextShortWindow = (now: number): number => Math.floor(now / SHORT_WINDOW_MS) * SHORT_WINDOW_MS + SHORT_WINDOW_MS;
const nextUtcMidnight = (now: number): number => {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
};
const pair = (value: string | null): [number, number] | undefined => {
  const parts = value?.split(",").map((part) => Number(part.trim()));
  return parts && parts.length >= 2 && parts.every(Number.isFinite) ? [parts[0], parts[1]] : undefined;
};

/**
 * Application-wide guard for Strava's 15-minute and daily limits. It honors the overall and
 * read-specific rate-limit headers and 429 responses so no request is sent while a window is
 * exhausted. Staza never polls; this only gates user-initiated requests.
 */
export class StravaRateGate {
  private blockedUntil = 0;

  constructor(private readonly now: () => number = Date.now) {}

  assertAvailable(): void {
    const now = this.now();
    if (now < this.blockedUntil) {
      throw new StravaError("rate_limited", Math.ceil((this.blockedUntil - now) / 1000));
    }
  }

  record(status: number, headers: Headers): void {
    const now = this.now();
    let until = 0;
    for (const prefix of ["X-RateLimit", "X-ReadRateLimit"]) {
      const limit = pair(headers.get(`${prefix}-Limit`));
      const usage = pair(headers.get(`${prefix}-Usage`));
      if (!limit || !usage) continue;
      if (usage[1] >= limit[1]) until = Math.max(until, nextUtcMidnight(now));
      else if (usage[0] >= limit[0]) until = Math.max(until, nextShortWindow(now));
    }
    if (status === 429) {
      const retryAfter = Number(headers.get("Retry-After"));
      until = Math.max(until, Number.isFinite(retryAfter) && retryAfter > 0 ? now + retryAfter * 1000 : nextShortWindow(now));
    }
    if (until > this.blockedUntil) this.blockedUntil = until;
  }
}

const statusCode = (status: number, notFound: StravaErrorCode): StravaErrorCode => {
  if (status === 401) return "reconnect_required";
  if (status === 403) return "activity_forbidden";
  if (status === 404) return notFound;
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_unavailable";
  return "provider_error";
};

export class StravaClient {
  constructor(
    private readonly settings: StravaClientConfig,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    private readonly gate: StravaRateGate = new StravaRateGate()
  ) {}

  authorizationUrl(state: string): string {
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: this.settings.clientId,
      redirect_uri: this.settings.redirectUri,
      response_type: "code",
      approval_prompt: "auto",
      scope: STRAVA_SCOPE,
      state
    }).toString();
    return url.toString();
  }

  async exchangeCode(code: string): Promise<StravaAuthorization> {
    const body = await this.tokenRequest({ grant_type: "authorization_code", code });
    const athleteId = (body.athlete as { id?: unknown } | undefined)?.id;
    if (typeof athleteId !== "number" || !Number.isSafeInteger(athleteId)) throw new StravaError("provider_error");
    return { ...this.tokenSet(body), athleteId };
  }

  async refresh(refreshToken: string): Promise<StravaTokenSet> {
    return this.tokenSet(await this.tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }));
  }

  /** Revokes the application's access remotely. Returns false instead of throwing. */
  async deauthorize(accessToken: string): Promise<boolean> {
    try {
      const response = await this.send(DEAUTHORIZE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ access_token: accessToken }).toString()
      });
      // An already-invalid token means the application no longer has access.
      return response.ok || response.status === 401;
    } catch {
      return false;
    }
  }

  /** One fixed first-page request; Staza never paginates through activity history. */
  async listRecentActivities(accessToken: string, limit: number): Promise<StravaActivitySummary[]> {
    const url = `${API_URL}/athlete/activities?${new URLSearchParams({ page: "1", per_page: String(limit) })}`;
    const body = await this.apiRequest(url, accessToken, "provider_error");
    if (!Array.isArray(body)) throw new StravaError("provider_error");
    return body.slice(0, limit).filter((item): item is StravaActivitySummary =>
      typeof item === "object" && item !== null && Number.isSafeInteger((item as { id?: unknown }).id));
  }

  /** Fetches only the selected activity's latlng and time streams. */
  async getActivityStreams(accessToken: string, activityId: string): Promise<StravaStreams> {
    const url = `${API_URL}/activities/${encodeURIComponent(activityId)}/streams?${new URLSearchParams({
      keys: "latlng,time",
      key_by_type: "true"
    })}`;
    const body = await this.apiRequest(url, accessToken, "invalid_streams");
    if (typeof body !== "object" || body === null) throw new StravaError("invalid_streams");
    if (Array.isArray(body)) {
      return Object.fromEntries(body
        .filter((stream) => typeof stream === "object" && stream !== null)
        .map((stream: { type?: unknown; data?: unknown }) => [String(stream.type), { data: stream.data }]));
    }
    return body as StravaStreams;
  }

  private tokenSet(body: Record<string, unknown>): StravaTokenSet {
    const { access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt } = body;
    if (typeof accessToken !== "string" || typeof refreshToken !== "string" || typeof expiresAt !== "number") {
      throw new StravaError("provider_error");
    }
    return { accessToken, refreshToken, expiresAt: new Date(expiresAt * 1000) };
  }

  private async tokenRequest(grant: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await this.send(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.settings.clientId,
        client_secret: this.settings.clientSecret,
        ...grant
      }).toString()
    });
    if (!response.ok) {
      // 400/401 from the token endpoint mean the code or refresh token is invalid or revoked.
      throw new StravaError(response.status === 400 || response.status === 401 ? "reconnect_required" : statusCode(response.status, "provider_error"));
    }
    const body = await this.json(response);
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw new StravaError("provider_error");
    return body as Record<string, unknown>;
  }

  private async apiRequest(url: string, accessToken: string, notFound: StravaErrorCode): Promise<unknown> {
    const response = await this.send(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new StravaError(statusCode(response.status, notFound), this.retryAfter(response));
    return this.json(response);
  }

  private retryAfter(response: Response): number | undefined {
    if (response.status !== 429) return undefined;
    const value = Number(response.headers.get("Retry-After"));
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    this.gate.assertAvailable();
    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      throw new StravaError("provider_unavailable");
    }
    this.gate.record(response.status, response.headers);
    return response;
  }

  private async json(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new StravaError("provider_error");
    }
  }
}
