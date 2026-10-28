import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { de, en, getLandingCopy, translateLandingTemplate, translations } from "./locales.js";

const template = readFileSync(path.resolve("public/landing/index.html"), "utf8");
const renderedEnglish = translateLandingTemplate(template, "en");
const renderedGerman = translateLandingTemplate(template, "de");

describe("landing page localization", () => {
  it("renders localized document language, SEO, canonical and hreflang URLs", () => {
    expect(renderedEnglish).toContain('<html lang="en">');
    expect(renderedEnglish).toContain(`<title>${en["landing.meta.title"]}</title>`);
    expect(renderedEnglish).toContain('<link rel="canonical" href="https://staza.world/" />');
    expect(renderedEnglish).toContain('<meta property="og:url" content="https://staza.world/" />');

    expect(renderedGerman).toContain('<html lang="de">');
    expect(renderedGerman).toContain(`<title>${de["landing.meta.title"]}</title>`);
    expect(renderedGerman).toContain(`content="${de["landing.meta.description"]}"`);
    expect(renderedGerman).toContain('<link rel="canonical" href="https://staza.world/de/" />');
    expect(renderedGerman).toContain('<meta property="og:url" content="https://staza.world/de/" />');
    expect(renderedGerman).toContain('<link rel="alternate" hreflang="en" href="https://staza.world/" />');
    expect(renderedGerman).toContain('<link rel="alternate" hreflang="de" href="https://staza.world/de/" />');
    expect(renderedGerman).toContain('<link rel="alternate" hreflang="x-default" href="https://staza.world/" />');
  });

  it("renders approved German headlines and localized user-facing mockup labels", () => {
    expect(renderedGerman).toContain("Die Welt ist");
    expect(renderedGerman).toContain("dein Spielfeld.");
    expect(renderedGerman).toContain("Mehrere Touren.");
    expect(renderedGerman).toContain("Ein gemeinsames Ziel.");
    expect(renderedGerman).toContain("Sammelobjekte");
    expect(renderedGerman).toContain("4 von 6 Orten gefunden");
    expect(renderedGerman).toContain("Beispiel-Quests zur Veranschaulichung.");
    expect(renderedGerman).toContain("250 XP");
    expect(renderedGerman).toContain("94,7 km");
    expect(renderedGerman).toContain("Schwarzwald, Deutschland");
    expect(renderedGerman).not.toContain("Join Early Access — Free");
    expect(renderedGerman).not.toContain("The world is");
    expect(renderedGerman).not.toContain("Every ride has a story.");
    expect(renderedGerman).not.toContain("{{landing.");
    expect(renderedEnglish).not.toContain("{{landing.");
  });

  it("keeps translation keys complete and resolves unknown locale entries through English", () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(translations.de).sort()).toEqual(Object.keys(translations.en).sort());
    expect(getLandingCopy("de", "landing.nav.discover")).toBe("Entdecken");
    expect(getLandingCopy("de", "landing.nav.discover.missing")).toBe("landing.nav.discover.missing");
    for (const [key, source] of Object.entries(en)) {
      if (de[key as keyof typeof de] === source) continue;
      const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      expect(renderedGerman, key).not.toMatch(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u"));
    }
  });

  it("renders corresponding language links with the active language identified", () => {
    expect(renderedEnglish.match(/href="\/"[^>]*aria-current="page"/g)).toHaveLength(2);
    expect(renderedGerman.match(/href="\/de\/"[^>]*aria-current="page"/g)).toHaveLength(2);
    expect(renderedGerman.match(/href="\/"[^>]*hreflang="en"/g)).toHaveLength(2);
    expect(renderedEnglish.match(/href="\/de\/"[^>]*hreflang="de"/g)).toHaveLength(2);
    expect(renderedGerman).toContain('<link rel="alternate" hreflang="en" href="https://staza.world/" />');
    expect(renderedGerman.match(/aria-label="Deutsch"/g)).toHaveLength(2);
    const script = readFileSync(path.resolve("public/landing/landing.js"), "utf8");
    expect(script).toContain("destination.pathname}${destination.search}${window.location.hash");
    expect(script).toContain("preserveLanguageFragment();");
  });

  it("leaves the authenticated app routes mapped to the app document", () => {
    const server = readFileSync(path.resolve("src/server.ts"), "utf8");
    expect(server).toContain('app.get(["/app", "/sign-in"]');
    expect(server).toContain("response.sendFile(appDocument)");
    expect(server).toContain('app.get(/^\\/(?:en|de)(?:\\/.*)?$/');
  });
});
