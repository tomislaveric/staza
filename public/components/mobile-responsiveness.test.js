import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AppShell } from "./app-shell.js";
import { MobileNavigation, navItems } from "./sidebar.js";

const appShellCss = readFileSync(new URL("../styles/app-shell.css", import.meta.url), "utf8");

describe("mobile app navigation", () => {
  it("renders the five primary destinations in a dedicated mobile navigation", () => {
    const navigation = MobileNavigation();

    expect(navItems.map(([screen]) => screen)).toEqual([
      "home",
      "activities",
      "world",
      "progress",
      "profile"
    ]);
    expect(navigation.match(/class="mobile-nav-item/g)).toHaveLength(5);
    expect(navigation).toContain('aria-label="Primary navigation"');
    expect(navigation).toContain('aria-current="page"');
  });

  it("keeps Add Activity separate from the primary destinations", () => {
    const navigation = MobileNavigation();

    expect(navigation).toContain('class="mobile-add-activity"');
    expect(navigation).not.toMatch(/mobile-nav-item[^>]+data-screen="add-activity"/);
    expect(AppShell()).toContain("mobile-navigation");
  });

  it("reserves scroll space for the fixed mobile controls", () => {
    expect(appShellCss).toMatch(/@media \(max-width: 720px\)/);
    expect(appShellCss).toMatch(/padding-bottom:\s*calc\(var\(--mobile-nav-height\) \+ var\(--mobile-action-space\)/);
    expect(appShellCss).toMatch(/grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/);
  });

  it("places replay collection details below the map on mobile", () => {
    expect(appShellCss).toMatch(/\.activity-replay-map\s*\{[^}]*height:\s*auto/s);
    expect(appShellCss).toMatch(/\.activity-replay-panel\s*\{[^}]*position:\s*static/s);
  });
});
