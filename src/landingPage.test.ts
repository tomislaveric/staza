import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getTotalXpRequiredForLevel } from "./progression.js";
import { translateLandingTemplate } from "./landing/locales.js";

const landingDirectory = path.resolve("public/landing");
const html = readFileSync(path.join(landingDirectory, "index.html"), "utf8");
const css = readFileSync(path.join(landingDirectory, "landing.css"), "utf8");
const script = readFileSync(path.join(landingDirectory, "landing.js"), "utf8");

const localReferences = (source: string): string[] =>
  [...source.matchAll(/(?:src|href)="(\/[^"#]+)"/g)]
    .map((match) => match[1]!)
    .filter((reference) => /\.(svg|jpg|png|css|js)$/.test(reference));

describe("landing page document", () => {
  it("exposes a single h1 and one h2 per section", () => {
    expect([...html.matchAll(/<h1\b/g)]).toHaveLength(1);
    const sections = [...html.matchAll(/<section\b[^>]*aria-labelledby="([^"]+)"/g)].map((match) => match[1]!);
    expect(sections.length).toBeGreaterThanOrEqual(6);
    for (const id of sections) {
      expect(html).toMatch(new RegExp(`<h2 class="[^"]+" id="${id}">`));
    }
  });

  it("uses semantic landmarks and a skip link", () => {
    expect(html).toContain("<header class=\"nav\"");
    expect(html).toContain("<main id=\"main\">");
    expect(html).toContain("<footer class=\"footer\">");
    expect(html).toContain('<a class="skip-link" href="#main">');
  });

  it("includes SEO and social metadata", () => {
    expect(html).toContain('<link rel="canonical" href="https://staza.world/" />');
    expect(html).toMatch(/<meta\s+name="description"\s+content="[^"]{60,}"/s);
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:image"');
    expect(html).toContain('name="twitter:card"');
    expect(html).toContain('<meta name="theme-color" content="#0B0C0F" />');
  });

  it("points every call to action at the sign-in route", () => {
    const ctas = [...html.matchAll(/<a class="button[^"]*" href="([^"]+)"/g)].map((match) => match[1]!);
    expect(ctas.length).toBeGreaterThanOrEqual(3);
    for (const target of ctas) {
      expect(target === "{{landing.signInPath}}" || target.startsWith("#")).toBe(true);
    }
    expect(translateLandingTemplate(html, "en")).toContain('href="https://play.staza.world/sign-in" data-app-locale="en"');
    expect(translateLandingTemplate(html, "de")).toContain('href="https://play.staza.world/sign-in" data-app-locale="de"');
  });

  it("keeps landing-page internal links and asset references same-origin", () => {
    const rendered = translateLandingTemplate(html, "en");
    const anchorTargets = [...rendered.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((match) => match[1]!);
    for (const target of anchorTargets) {
      if (target.startsWith("#")) continue;
      if (target === "https://play.staza.world/sign-in") continue;
      expect(target).toMatch(/^\/(?!\/)/);
    }

    const assets = [...rendered.matchAll(/(?:src|href)="([^"]+\.(?:svg|jpg|png|css|js))"/g)].map((match) => match[1]!);
    expect(assets.length).toBeGreaterThanOrEqual(6);
    for (const asset of assets) expect(asset).toMatch(/^\/(?!\/)/);
  });

  it("resolves every in-page anchor to an existing element id", () => {
    const anchors = new Set(
      [...html.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]!)
    );
    expect(anchors.size).toBeGreaterThanOrEqual(5);
    for (const anchor of anchors) {
      expect(html).toContain(`id="${anchor}"`);
    }
  });

  it("references only local assets that exist on disk", () => {
    const references = localReferences(html);
    expect(references.length).toBeGreaterThanOrEqual(6);
    for (const reference of references) {
      expect(existsSync(path.resolve("public", `.${reference}`))).toBe(true);
    }
  });

  it("contains no Figma or other remote asset URLs", () => {
    for (const source of [html, css, script]) {
      expect(source).not.toMatch(/figma\.com|s3-alpha|figma-alpha-api/i);
    }
    expect(css).not.toMatch(/url\(\s*["']?https?:/i);
  });
});

describe("landing page isolation from the authenticated app", () => {
  it("does not load the application bundle, MapLibre, or session endpoints", () => {
    for (const forbidden of ["maplibre", "/app.js", "/shared/webauthn", "/api/auth/session", "/api/"]) {
      expect(html).not.toContain(forbidden);
    }
    expect(script).not.toContain("fetch(");
    expect(script).not.toContain("/api/");
  });

  it("loads only its own stylesheet and script", () => {
    const stylesheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((match) => match[1]!);
    expect(stylesheets).toEqual(["/landing/landing.css"]);
    const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((match) => match[1]!);
    expect(scripts).toEqual(["/landing/landing.js"]);
  });

  it("keeps the landing palette out of the shared design tokens", () => {
    const tokens = readFileSync(path.resolve("public/styles/design-tokens.css"), "utf8");
    expect(tokens).not.toContain("--landing-");
    expect(css).toContain("--landing-accent: #ffd83d");
  });

  it("satisfies the strict content security policy by avoiding inline script and style blocks", () => {
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
  });
});

describe("landing page content accuracy", () => {
  it("omits unsupported marketing claims", () => {
    const forbidden = [
      "12,000+",
      "47 countries",
      "50,000",
      "Beta launching 2025",
      "© 2025",
      "Available on iOS",
      "Android"
    ];
    for (const claim of forbidden) {
      expect(html).not.toContain(claim);
    }
  });

  it("does not present testimonials, ratings, or reviews", () => {
    expect(html).not.toMatch(/testimonial|★|rating|reviews?\b/i);
    expect(html).not.toMatch(/beta tester/i);
  });

  it("labels illustrative product mockups as examples", () => {
    expect([...html.matchAll(/class="mockup-note"/g)].length).toBeGreaterThanOrEqual(2);
  });

  it("uses the real collectible categories and XP values", () => {
    for (const category of ["Mountain Pass", "Summit", "Castle", "Waterfall", "Viewpoint"]) {
      expect(html).toContain(`>${category}</h3>`);
    }
    for (const value of ["100–600 XP", "50 XP", "35 XP", "20 XP"]) {
      expect(html).toContain(value);
    }
    expect(html).not.toContain("Ancient Ruin");
  });

  it("shows real level thresholds without named ranks", () => {
    for (const level of [5, 6, 8, 9, 10]) {
      const threshold = getTotalXpRequiredForLevel(level).toLocaleString("en-US");
      expect(html).toContain(`>Level ${level}</span>`);
      expect(html).toContain(`>${threshold} XP</span>`);
    }
    for (const rank of ["Adventurer", "Pathfinder", "Trailblazer", "Waymaker"]) {
      expect(html).not.toContain(rank);
    }
  });
});
