import { expect, test, type Locator, type Page } from "@playwright/test";

const activityId = process.env.E2E_ACTIVITY_ID;
const screens = [
  "/home", "/world", "/skill-tree", "/progress", "/activities", "/profile", "/add-activity",
  ...(activityId ? [`/activities/${encodeURIComponent(activityId)}`] : [])
];

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 0) <= 720;

const openApp = async (page: Page, path: string) => {
  await page.goto(path);
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator(".main-content > *").first()).toBeVisible();
};

/** True when the element's centre is the topmost hit target, i.e. no fixed UI covers it. */
const isUnobstructed = (locator: Locator) => locator.evaluate((element) => {
  const rect = element.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return Boolean(hit && (hit === element || element.contains(hit)));
});

const boxesOverlap = async (first: Locator, second: Locator) => {
  const [a, b] = [await first.boundingBox(), await second.boundingBox()];
  if (!a || !b) return false;
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
};

const mobileNav = (page: Page) => page.getByRole("navigation", { name: "Primary navigation" }).locator("visible=true");

test.describe("responsive layout", () => {
  for (const path of screens) {
    test(`${path} has no horizontal overflow and clears fixed navigation`, async ({ page }) => {
      await openApp(page, path);
      await page.waitForTimeout(500);
      const metrics = await page.evaluate(() => {
        const main = document.querySelector<HTMLElement>(".main-content")!;
        main.scrollTop = main.scrollHeight;
        const navRect = document.querySelector(".mobile-nav-menu")?.getBoundingClientRect();
        const navTop = navRect && navRect.height > 0 ? navRect.top : innerHeight;
        const page = main.firstElementChild!.getBoundingClientRect();
        return {
          documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          mainOverflow: main.scrollWidth - main.clientWidth,
          contentBottom: page.bottom,
          navTop
        };
      });
      expect(metrics.documentOverflow).toBeLessThanOrEqual(0);
      expect(metrics.mainOverflow).toBeLessThanOrEqual(0);
      expect(metrics.contentBottom).toBeLessThanOrEqual(metrics.navTop + 1);
    });
  }
});

test.describe("mobile navigation", () => {
  test.beforeEach(({ page }) => test.skip(!isMobile(page), "Mobile navigation is shown up to 720px."));

  test("shows four primary destinations and More", async ({ page }) => {
    await openApp(page, "/home");
    await expect(page.locator(".sidebar")).toBeHidden();
    await expect(mobileNav(page).getByRole("button")).toHaveText(["Home", "World", "Skill Atlas", "Progress", "More"]);
    await expect(mobileNav(page).getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
  });

  test("navigates between primary destinations and marks the current one", async ({ page }) => {
    await openApp(page, "/home");
    for (const [name, path] of [["World", "/world"], ["Skill Atlas", "/skill-tree"], ["Progress", "/progress"], ["Home", "/home"]]) {
      await mobileNav(page).getByRole("button", { name }).click();
      await expect(page).toHaveURL(path);
      await expect(mobileNav(page).getByRole("button", { name })).toHaveAttribute("aria-current", "page");
      await expect(mobileNav(page).locator('[aria-current="page"]')).toHaveCount(1);
    }
  });

  test("reaches Activities and Profile through More", async ({ page }) => {
    await openApp(page, "/home");
    const more = mobileNav(page).getByRole("button", { name: "More" });
    const menu = page.getByRole("navigation", { name: "More destinations" });
    await expect(menu).toBeHidden();

    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(menu.getByRole("button")).toHaveText(["Activities", "Profile"]);
    expect(await isUnobstructed(menu.getByRole("button", { name: "Profile" }))).toBe(true);
    await menu.getByRole("button", { name: "Activities" }).click();
    await expect(page).toHaveURL("/activities");
    await expect(menu).toBeHidden();
    await expect(more).toHaveAttribute("aria-current", "page");
    await expect(more).toHaveAttribute("aria-expanded", "false");

    await more.click();
    await expect(menu.getByRole("button", { name: "Activities" })).toHaveAttribute("aria-current", "page");
    await menu.getByRole("button", { name: "Profile" }).click();
    await expect(page).toHaveURL("/profile");
    await expect(more).toHaveAttribute("aria-current", "page");

    await mobileNav(page).getByRole("button", { name: "World" }).click();
    await expect(more).not.toHaveAttribute("aria-current", "page");
  });

  test("closes More with Escape and outside taps", async ({ page }) => {
    await openApp(page, "/home");
    const more = mobileNav(page).getByRole("button", { name: "More" });
    const menu = page.getByRole("navigation", { name: "More destinations" });
    await more.click();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(more).toBeFocused();
    await more.click();
    await page.locator(".main-content").click({ position: { x: 10, y: 10 } });
    await expect(menu).toBeHidden();
    await expect(page).toHaveURL("/home");
  });

  test("keeps More current on Activity detail", async ({ page }) => {
    test.skip(!activityId, "The e2e user has no activities.");
    await openApp(page, `/activities/${encodeURIComponent(activityId!)}`);
    await expect(mobileNav(page).getByRole("button", { name: "More" })).toHaveAttribute("aria-current", "page");
  });

  test("keeps Add Activity reachable without covering navigation or the World map", async ({ page }) => {
    await openApp(page, "/world");
    const add = page.locator(".mobile-header").getByRole("button", { name: "Add Activity" });
    await expect(add).toBeVisible();
    expect(await isUnobstructed(add)).toBe(true);
    expect(await boxesOverlap(add, page.locator(".world-map-shell"))).toBe(false);
    expect(await boxesOverlap(add, mobileNav(page))).toBe(false);
    await expect(mobileNav(page).getByRole("button", { name: /add activity/i })).toHaveCount(0);

    await add.click();
    await expect(page).toHaveURL("/add-activity");
    await expect(add).toHaveClass(/is-current/);
    await expect(mobileNav(page).locator('[aria-current="page"]')).toHaveCount(0);
  });
});

test.describe("World map", () => {
  test("keeps map controls usable and the page scrollable", async ({ page }) => {
    await openApp(page, "/world");
    const shell = page.locator(".world-map-shell");
    await expect(shell).toBeVisible({ timeout: 15_000 });
    const zoomIn = shell.getByRole("button", { name: "Zoom in" });
    await expect(zoomIn).toBeVisible({ timeout: 15_000 });

    const controls = [zoomIn, shell.getByRole("button", { name: "Zoom out" }), shell.locator("[data-world-locate]"), shell.locator("[data-world-explore]")];
    // Bring the whole map into view, then confirm no fixed UI or map chrome covers the controls.
    await shell.evaluate((element) => element.scrollIntoView({ block: "end" }));
    await page.waitForTimeout(300);
    for (const control of controls) {
      await expect(control).toBeInViewport();
      expect(await isUnobstructed(control)).toBe(true);
    }

    if (isMobile(page)) {
      const filters = page.locator("[data-world-filter-controls] > button:visible");
      const tops = await filters.evaluateAll((buttons) => new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top))).size);
      expect(tops).toBe(1);
      const shellBox = (await shell.boundingBox())!;
      expect(shellBox.height).toBeGreaterThanOrEqual(320);
    }

    const scroll = await page.locator(".main-content").evaluate((main) => {
      main.scrollTop = main.scrollHeight;
      return { scrollable: main.scrollHeight > main.clientHeight, scrollTop: main.scrollTop };
    });
    if (scroll.scrollable) expect(scroll.scrollTop).toBeGreaterThan(0);
    await expect(page.locator("[data-world-stats]")).toBeInViewport();
  });
});

test.describe("Activity replay map", () => {
  test("keeps zoom controls clear of the Collectibles button", async ({ page }) => {
    test.skip(!activityId, "The e2e user has no activities.");
    await openApp(page, `/activities/${encodeURIComponent(activityId!)}`);
    await page.locator(".activity-tabs").waitFor();
    const replay = page.locator(".activity-replay-map");
    test.skip(await replay.count() === 0, "The activity has no replay.");
    const zoomIn = replay.getByRole("button", { name: "Zoom in" });
    await expect(zoomIn).toBeVisible({ timeout: 15_000 });
    // Starting playback collapses the collectibles panel into the top-right Report button.
    await replay.getByRole("button", { name: "Play replay" }).click();
    const reopen = replay.getByRole("button", { name: "Show activity report" });
    await expect(reopen).toBeVisible();
    expect(await boxesOverlap(zoomIn, reopen)).toBe(false);
    expect(await isUnobstructed(zoomIn)).toBe(true);
  });
});

test.describe("desktop and tablet navigation", () => {
  test.beforeEach(({ page }) => test.skip(isMobile(page), "Sidebar navigation is shown above 720px."));

  test("keeps the sidebar with all destinations and Add Activity", async ({ page }) => {
    await openApp(page, "/home");
    await expect(page.locator(".mobile-navigation")).toBeHidden();
    await expect(page.locator(".mobile-header")).toBeHidden();
    const sidebar = page.locator(".sidebar");
    await expect(sidebar.getByRole("navigation", { name: "Primary navigation" }).getByRole("button"))
      .toHaveText(["Home", "Activities", "World", "Skill Atlas", "Progress", "Profile"]);
    await sidebar.getByRole("button", { name: "Activities" }).click();
    await expect(page).toHaveURL("/activities");
    await expect(sidebar.getByRole("button", { name: "Activities" })).toHaveAttribute("aria-current", "page");
    await sidebar.getByRole("button", { name: "ADD ACTIVITY" }).click();
    await expect(page).toHaveURL("/add-activity");
  });
});
