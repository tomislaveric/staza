import type { RoutingRequest, RoutingResult } from "./types.js";

export type RoutingErrorCode =
  | "timeout"
  | "unavailable"
  | "no_route"
  | "point_not_routable"
  | "snap_distance_exceeded"
  | "rate_limited"
  | "invalid_request"
  | "invalid_response";

/** A stable, sanitized routing failure. Never carries upstream bodies beyond safe details. */
export class RoutingError extends Error {
  constructor(
    readonly code: RoutingErrorCode,
    message: string,
    /** Routing-service location index (0 = start) for point-specific failures. */
    readonly waypointIndex?: number
  ) {
    super(message);
  }
}

export interface RoutingClientConfig {
  baseUrl: string;
  timeoutMs: number;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isNullableNumber = (value: unknown): value is number | null => value === null || isFiniteNumber(value);

const upstreamCodes: Record<string, RoutingErrorCode> = {
  ROUTE_NOT_FOUND: "no_route",
  POINT_NOT_ROUTABLE: "point_not_routable",
  SNAP_DISTANCE_EXCEEDED: "snap_distance_exceeded",
  RATE_LIMITED: "rate_limited",
  INVALID_REQUEST: "invalid_request",
  UNSUPPORTED_PROFILE: "invalid_request",
  VALHALLA_TIMEOUT: "timeout",
  VALHALLA_UNAVAILABLE: "unavailable"
};

/** Validates the subset of the routing response Staza relies on. */
export const parseRoutingResponse = (body: unknown): RoutingResult => {
  if (!isRecord(body)) throw new RoutingError("invalid_response", "Routing response is not an object.");
  const { distanceM, durationS, elevationGainM, elevationLossM, geometry, waypoints } = body;
  if (!isFiniteNumber(distanceM) || distanceM < 0 || !isFiniteNumber(durationS) || durationS < 0) {
    throw new RoutingError("invalid_response", "Routing response has invalid metrics.");
  }
  if (!isNullableNumber(elevationGainM ?? null) || !isNullableNumber(elevationLossM ?? null)) {
    throw new RoutingError("invalid_response", "Routing response has invalid elevation.");
  }
  if (!isRecord(geometry) || geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)
    || geometry.coordinates.length < 2
    || !geometry.coordinates.every((position) => Array.isArray(position) && position.length >= 2
      && isFiniteNumber(position[0]) && isFiniteNumber(position[1])
      && Math.abs(position[0]) <= 180 && Math.abs(position[1]) <= 90)) {
    throw new RoutingError("invalid_response", "Routing response has invalid geometry.");
  }
  if (!Array.isArray(waypoints) || !waypoints.every((waypoint) => isRecord(waypoint)
    && Number.isInteger(waypoint.index) && typeof waypoint.type === "string" && isFiniteNumber(waypoint.snapDistanceM))) {
    throw new RoutingError("invalid_response", "Routing response has invalid waypoints.");
  }
  return {
    distanceM,
    durationS,
    elevationGainM: (elevationGainM as number | null | undefined) ?? null,
    elevationLossM: (elevationLossM as number | null | undefined) ?? null,
    geometry: {
      type: "LineString",
      coordinates: (geometry.coordinates as number[][]).map(([lon, lat]) => [lon, lat] as [number, number])
    },
    waypoints: (waypoints as Array<Record<string, unknown>>).map((waypoint) => ({
      index: waypoint.index as number,
      type: waypoint.type as string,
      snapDistanceM: waypoint.snapDistanceM as number
    }))
  };
};

const parseErrorBody = (status: number, body: unknown): RoutingError => {
  const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
  const upstream = typeof error?.code === "string" ? error.code : undefined;
  const code: RoutingErrorCode = (upstream ? upstreamCodes[upstream] : undefined)
    ?? (status === 429 ? "rate_limited" : status === 504 ? "timeout" : status >= 500 ? "unavailable" : "invalid_response");
  const details = isRecord(error?.details) ? error.details : undefined;
  const waypointIndex = Number.isInteger(details?.waypointIndex) ? details!.waypointIndex as number : undefined;
  return new RoutingError(code, `Routing failed (${code}).`, waypointIndex);
};

/**
 * Staza-side adapter for the standalone, domain-agnostic routing service. It is the only
 * module that talks to that service: no other code builds routing HTTP requests.
 */
export class RoutingClient {
  private readonly endpoint: string;

  constructor(private readonly settings: RoutingClientConfig, private readonly fetchImpl: FetchLike = fetch) {
    this.endpoint = new URL("/v1/routes", settings.baseUrl).toString();
  }

  async route(request: RoutingRequest, { requestId, signal }: { requestId?: string; signal?: AbortSignal } = {}): Promise<RoutingResult> {
    const timeout = AbortSignal.timeout(this.settings.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(requestId ? { "X-Request-Id": requestId } : {})
        },
        body: JSON.stringify(request),
        signal: combined
      });
    } catch (error) {
      if (combined.aborted || (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))) {
        throw new RoutingError("timeout", "Routing request timed out.");
      }
      throw new RoutingError("unavailable", "Routing service is unreachable.");
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      if (combined.aborted) throw new RoutingError("timeout", "Routing request timed out.");
      throw response.ok
        ? new RoutingError("invalid_response", "Routing response is not JSON.")
        : parseErrorBody(response.status, undefined);
    }
    if (!response.ok) throw parseErrorBody(response.status, body);
    return parseRoutingResponse(body);
  }
}
