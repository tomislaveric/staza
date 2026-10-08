export type StravaErrorCode =
  | "strava_disabled"
  | "not_connected"
  | "reconnect_required"
  | "invalid_activity_id"
  | "activity_not_found"
  | "activity_forbidden"
  | "invalid_streams"
  | "rate_limited"
  | "provider_unavailable"
  | "provider_error";

const statusByCode: Record<StravaErrorCode, number> = {
  strava_disabled: 404,
  not_connected: 409,
  reconnect_required: 409,
  invalid_activity_id: 400,
  activity_not_found: 404,
  activity_forbidden: 403,
  invalid_streams: 422,
  rate_limited: 429,
  provider_unavailable: 502,
  provider_error: 502
};

const messageByCode: Record<StravaErrorCode, string> = {
  strava_disabled: "Strava integration is not available.",
  not_connected: "Connect Strava before importing activities.",
  reconnect_required: "Your Strava connection expired or was revoked. Reconnect Strava to continue.",
  invalid_activity_id: "Choose one Strava activity to import.",
  activity_not_found: "That Strava activity is not in your recent activities.",
  activity_forbidden: "Strava did not allow access to that activity.",
  invalid_streams: "This Strava activity has no usable GPS route.",
  rate_limited: "Strava is temporarily limiting requests. Try again later.",
  provider_unavailable: "Strava is temporarily unavailable. Try again later.",
  provider_error: "Strava returned an unexpected response. Try again later."
};

/** A sanitized Strava failure. Messages never contain provider bodies, tokens, or codes. */
export class StravaError extends Error {
  readonly status: number;

  constructor(readonly code: StravaErrorCode, readonly retryAfterSeconds?: number) {
    super(messageByCode[code]);
    this.status = statusByCode[code];
  }
}
