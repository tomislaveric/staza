import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AppShell } from "./app-shell.js";
import { MobileHeader, MobileNavigation } from "./sidebar.js";

const appShellCss = readFileSync(new URL("../styles/app-shell.css", import.meta.url), "utf8");

describe("mobile app navigation", () => {
  it("renders four primary destinations and a More menu for secondary screens", () => {
    const navigation = MobileNavigation();
    const primary = navigation.slice(navigation.indexOf('class="mobile-nav-menu"'));

    expect([...primary.matchAll(/class="mobile-nav-item[^"]*" type="button" data-screen="([^"]+)"/g)].map(([, screen]) => screen))
      .toEqual(["home", "world", "skill-tree", "progress"]);
    expect(primary).toContain('data-mobile-more');
    expect(primary).toContain('aria-expanded="false"');
    expect([...navigation.matchAll(/class="mobile-more-item" type="button" data-screen="([^"]+)"/g)].map(([, screen]) => screen))
      .toEqual(["activities", "profile"]);
    expect(navigation).toContain('aria-label="Primary navigation"');
    expect(navigation).toContain('aria-current="page"');
  });

  it("keeps Add Activity in the mobile header, outside the bottom navigation", () => {
    expect(MobileHeader()).toContain('class="mobile-add-activity"');
    expect(MobileNavigation()).not.toContain('data-screen="add-activity"');
    expect(AppShell()).toContain("mobile-header");
    expect(AppShell()).toContain("mobile-navigation");
  });

  it("reserves scroll space for the fixed mobile navigation", () => {
    expect(appShellCss).toMatch(/@media \(max-width: 720px\)/);
    expect(appShellCss).toMatch(/padding-bottom:\s*var\(--mobile-nav-clearance\)/);
    expect(appShellCss).toMatch(/grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/);
  });

  it("keeps the replay collection panel over the map on mobile", () => {
    expect(appShellCss).toMatch(/\.activity-replay-map\s*\{[^}]*height:\s*auto/s);
    expect(appShellCss).not.toMatch(/\.activity-replay-panel\s*\{[^}]*position:\s*static/s);
  });
});
