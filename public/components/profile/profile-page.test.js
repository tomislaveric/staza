import { describe, expect, it } from "vitest";
import { profileAccountView, profileOverviewView, profilePasskeysView } from "./profile-page.js";

const session = { user: { email: "rider@example.com", emailVerified: true } };

describe("Profile views", () => {
  it("renders only supplied player and canonical overview data", () => {
    const view = profileOverviewView({
      displayName: "Rider",
      distanceMeters: 12_500,
      activityCount: 3,
      progress: { level: 4, totalXp: 650, currentLevelXp: 50, nextLevelXp: 400, progressToNextLevel: .125 },
      collectibles: { discoveredCount: 4, totalCollectibles: 20, rareFinds: 1, epicFinds: 1 }
    }, session);
    expect(view).toContain("Rider");
    expect(view).toContain("4 of 20");
    expect(view).not.toContain("achievement");
    expect(view).not.toContain("@alexrides");
  });

  it("renders verified email and canonical account actions", () => {
    const view = profileAccountView(session, 2);
    expect(view).toContain("rider@example.com");
    expect(view).toContain("Verified");
    expect(view).toContain('data-profile-action="logout-all"');
    expect(view).toContain("Export my data");
  });

  it("renders safe passkey fields without credential internals", () => {
    const view = profilePasskeysView([{ id: "passkey-id", name: "Passkey", createdAt: "2026-09-01T00:00:00.000Z" }]);
    expect(view).toContain("Passkey");
    expect(view).toContain("data-remove-passkey");
    expect(view).not.toContain("credential_id");
    expect(view).not.toContain("public_key");
  });

  it("shows Strava connection controls only when the integration is enabled", () => {
    const profile = {
      displayName: "Rider",
      distanceMeters: 0,
      activityCount: 0,
      progress: { level: 1, totalXp: 0, currentLevelXp: 0, nextLevelXp: 100, progressToNextLevel: 0 },
      collectibles: { discoveredCount: 0, totalCollectibles: 0, rareFinds: 0, epicFinds: 0 }
    };
    expect(profileOverviewView(profile, session, "disabled")).not.toContain("CONNECTIONS");
    expect(profileOverviewView(profile, session, "disconnected")).toContain('data-profile-action="strava-connect"');
    const connected = profileOverviewView(profile, session, "connected");
    expect(connected).toContain("CONNECTIONS");
    expect(connected).toContain('data-profile-action="strava-disconnect"');
  });
});
