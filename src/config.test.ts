import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Strava configuration", () => {
  it("uses the default activity limit when the optional environment value is blank", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("STRAVA_CLIENT_ID", "12345");
    vi.stubEnv("STRAVA_CLIENT_SECRET", "secret");
    vi.stubEnv("STRAVA_REDIRECT_URI", "https://example.test/api/integrations/strava/callback");
    vi.stubEnv("STRAVA_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("base64"));
    vi.stubEnv("STRAVA_RECENT_ACTIVITY_LIMIT", "");

    const { config } = await import("./config.js");

    expect(config.strava?.recentActivityLimit).toBe(3);
  });
});
