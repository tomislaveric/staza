import { describe, expect, it, vi } from "vitest";
import { RoutingClient } from "./routingClient.js";
import type { RoutingRequest } from "./types.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const request: RoutingRequest = {
  profile: "bicycle",
  start: { lat: 46.5, lon: 15.6 },
  end: { lat: 46.5, lon: 15.6 },
  waypoints: [{ type: "via", lat: 46.52, lon: 15.62 }]
};

const validBody = {
  profile: "bicycle",
  distanceM: 12_345.6,
  durationS: 2_400,
  elevationGainM: 120,
  elevationLossM: null,
  elevationProfile: [],
  geometry: { type: "LineString", coordinates: [[15.6, 46.5], [15.62, 46.52], [15.6, 46.5]] },
  waypoints: [
    { index: 0, type: "start", requested: { lat: 46.5, lon: 15.6 }, snapped: { lat: 46.5, lon: 15.6 }, snapDistanceM: 3 },
    { index: 1, type: "via", requested: { lat: 46.52, lon: 15.62 }, snapped: { lat: 46.52, lon: 15.62 }, snapDistanceM: 10 }
  ],
  legs: [],
  maneuvers: []
};

const client = (fetchImpl: (input: string, init?: RequestInit) => Promise<Response>, timeoutMs = 1_000) =>
  new RoutingClient({ baseUrl: "http://routing.test", timeoutMs }, fetchImpl);

describe("RoutingClient", () => {
  it("posts the neutral request and parses a valid response", async () => {
    const fetchImpl = vi.fn(async () => json(validBody));
    const result = await client(fetchImpl).route(request, { requestId: "plan-1" });
    expect(result).toMatchObject({ distanceM: 12_345.6, durationS: 2_400, elevationGainM: 120, elevationLossM: null });
    expect(result.geometry.coordinates).toHaveLength(3);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://routing.test/v1/routes");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("X-Request-Id")).toBe("plan-1");
    expect(JSON.parse(String(init.body))).toEqual(request);
  });

  it("maps timeouts to a timeout error", async () => {
    const fetchImpl = (_input: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
    await expect(client(fetchImpl, 20).route(request)).rejects.toMatchObject({ code: "timeout" });
  });

  it("maps connection failures to unavailable", async () => {
    await expect(client(async () => { throw new TypeError("fetch failed"); }).route(request))
      .rejects.toMatchObject({ code: "unavailable" });
  });

  it("rejects malformed responses", async () => {
    await expect(client(async () => json({ ...validBody, geometry: { type: "Point", coordinates: [1, 2] } })).route(request))
      .rejects.toMatchObject({ code: "invalid_response" });
    await expect(client(async () => new Response("not json", { status: 200 })).route(request))
      .rejects.toMatchObject({ code: "invalid_response" });
  });

  it("maps routing-service errors to stable codes with waypoint attribution", async () => {
    const error = (code: string, status: number, details: unknown = {}) =>
      client(async () => json({ error: { code, message: "upstream text", details } }, status)).route(request);
    await expect(error("ROUTE_NOT_FOUND", 422)).rejects.toMatchObject({ code: "no_route" });
    await expect(error("SNAP_DISTANCE_EXCEEDED", 422, { waypointIndex: 1, distanceM: 900, limitM: 500 }))
      .rejects.toMatchObject({ code: "snap_distance_exceeded", waypointIndex: 1 });
    await expect(error("RATE_LIMITED", 429)).rejects.toMatchObject({ code: "rate_limited" });
    await expect(error("VALHALLA_UNAVAILABLE", 503)).rejects.toMatchObject({ code: "unavailable" });
    const caught = await error("VALHALLA_ERROR", 502).then(() => undefined, (value: unknown) => value as Error);
    expect(caught).toMatchObject({ code: "unavailable" });
    expect(caught?.message).not.toContain("upstream text");
  });
});
