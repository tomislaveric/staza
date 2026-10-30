import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appCopy,
  appPath,
  appRoutes,
  getLocalePreference,
  localeCookieName,
  parseAppPath,
  resolvePreferredLocale,
  setAppLocale,
  setLocalePreference,
  translateAppText,
  translateAppTextNode
} from "./app-locales.js";
import { AppShell } from "./components/app-shell.js";
import { LanguageSelector } from "./components/language-selector.js";
import { formatActivityDate, formatActivityDistance } from "./components/activities-page.js";

afterEach(() => vi.unstubAllGlobals());

describe("public app locale and route handling", () => {
  it("keeps the English and German UI catalogs in sync", () => {
    expect(Object.keys(appCopy.de).sort()).toEqual(Object.keys(appCopy.en).sort());
    expect(translateAppText("Activities", "de")).toBe("Aktivitäten");
    expect(translateAppText("Activities", "en")).toBe("Activities");
    for (const copy of [
      "Welcome back",
      "Complete a FIT activity to see your exploration history here.",
      "Passkeys use your device to sign in without a password.",
      "Nothing curated here yet.",
      "Select which moments to include in your highlight video"
    ]) {
      expect(appCopy.de[copy]).toBeTruthy();
    }
  });

  it("uses locale-neutral routes and includes a language selector", () => {
    expect(AppShell("de")).toContain('href="/home"');
    expect(AppShell("de")).not.toContain('data-locale-selector');
    const selector = LanguageSelector("de");
    expect(selector).toContain('🇩🇪');
    expect(selector).toContain('value="de" data-locale-selector checked');
    setAppLocale("de");
    expect(formatActivityDistance(5_400)).toBe("5,4 km");
    expect(formatActivityDate("2026-09-26T12:00:00.000Z")).not.toBe("SAT, SEP 26");
    setAppLocale("en");
    expect(formatActivityDistance(5_400)).toBe("5.4 km");
  });

  it("selects the first supported browser language and falls back to English", () => {
    expect(resolvePreferredLocale(["fr-FR", "de-DE", "en-US"])).toBe("de");
    expect(resolvePreferredLocale(["fr-FR", "en-GB"])).toBe("en");
    expect(resolvePreferredLocale(["fr-FR", "it-IT"])).toBe("en");
  });

  it("prefers a saved locale over browser preferences and falls back to browser language", () => {
    expect(parseAppPath("/home", ["en-US"], "de")).toMatchObject({ locale: "de", screen: "home" });
    expect(parseAppPath("/world", ["de-DE"], undefined)).toMatchObject({ locale: "de", screen: "world" });
    expect(parseAppPath("/world", ["fr-FR"], "invalid")).toMatchObject({ locale: "en", screen: "world" });
    expect(getLocalePreference(`${localeCookieName}=de; other=value`)).toBe("de");
    expect(getLocalePreference(`${localeCookieName}=fr`)).toBeUndefined();
  });

  it("maps every declared screen to a locale-neutral route", () => {
    for (const [screen] of Object.entries(appRoutes)) {
      const path = appPath(screen, "activity/id");
      const route = parseAppPath(path, ["de-DE"]);
      expect(route.locale).toBe("de");
      expect(route.screen).toBe(screen);
      if (screen === "activity-detail") expect(route.activityId).toBe("activity/id");
    }
    expect(appPath("home")).toBe("/home");
    expect(appPath("activity-detail", "ride 1")).toBe("/activities/ride%201");
  });

  it("parses shared sign-in routes and no longer recognizes locale-prefixed URLs", () => {
    expect(parseAppPath("/sign-in", ["fr-FR"])).toMatchObject({
      locale: "en",
      screen: "sign-in",
      path: "/sign-in"
    });
    expect(parseAppPath("/de/start", ["en-US"]).screen).toBe("not-found");
    expect(parseAppPath("/en/world", ["de-DE"]).screen).toBe("not-found");
  });

  it("writes a shared secure cookie on Staza hosts and a host-only cookie locally", () => {
    vi.stubGlobal("document", { cookie: "" });
    setLocalePreference("de", { hostname: "dev.play.staza.world", protocol: "https:" });
    expect(document.cookie).toBe("staza_locale=de; Max-Age=31536000; Path=/; SameSite=Lax; Domain=staza.world; Secure");
    setLocalePreference("en", { hostname: "localhost", protocol: "http:" });
    expect(document.cookie).toBe("staza_locale=en; Max-Age=31536000; Path=/; SameSite=Lax");
    expect(() => setLocalePreference("fr")).toThrow("Unsupported app locale: fr");
  });

  it("preserves dynamic text in localized message prefixes", () => {
    expect(translateAppTextNode("Unable to load World: server response", "de"))
      .toBe("Welt konnte nicht geladen werden: server response");
    expect(translateAppTextNode("rider@example.com", "de")).toBe("rider@example.com");
  });

  it("returns a not-found route for unknown paths and malformed activity ids", () => {
    expect(parseAppPath("/unknown", ["en-US"]).screen).toBe("not-found");
    expect(parseAppPath("/activities/%E0%A4%A", ["de-DE"]).screen).toBe("not-found");
  });
});
