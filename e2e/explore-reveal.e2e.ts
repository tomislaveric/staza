import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Explore (wide viewport, clamped frame) → generate one route → edit → save → start with stubbed World data, so the flow does not depend on the
 * test player's history. The real page, map and client logic run unchanged.
 */
const line = (lon: number) => ({ type: "LineString", coordinates: [[lon, 47.5], [lon + 0.02, 47.51]] });
const flowline = (id: string, name: string, lon: number, character: "flow" | "endurance") => ({
  id, name, geometry: line(lon), completed: false, lengthMeters: 3800,
  flowScore: character === "flow" ? 84 : 55, enduranceScore: character === "endurance" ? 80 : 40, roadQualityScore: 91,
  character: { primary: character, tags: [character] }
});
const opportunities = [flowline("f-rhine", "Rheintal Flowline", 8.5, "flow"), flowline("f-hills", "Hill Loop", 8.55, "endurance")];
const castle = { id: "c-castle", name: "Hill Castle", type: "landmark", primaryCategory: "castle", found: false, latitude: 47.505, longitude: 8.51 };
const routeGeometry = { type: "LineString", coordinates: [[8.5, 47.5], [8.52, 47.51], [8.5, 47.5]] };
const proposal = (id: string, includedTargetIds: string[]) => ({
  id, label: "balanced", recommended: true, distanceM: 24_000, durationS: 4_200, geometry: routeGeometry,
  routeType: "round_trip", start: { lat: 47.5, lon: 8.5 }, end: { lat: 47.5, lon: 8.5 },
  includedTargetIds, traversedFlowlines: [{ id: "f-rhine", name: "Rheintal Flowline", lengthMeters: 3800 }]
});

const objectives = [{
  objective: { id: "flowlines", type: "flowline_rule", requiredCount: 1, targets: [{ id: "f-rhine", name: "Rheintal Flowline" }] },
  progress: { completed: 0, required: 1, complete: false },
  targetProgress: [{ id: "f-rhine", name: "Rheintal Flowline", complete: false }]
}];
const instance = (status: "planned" | "active") => ({
  id: "00000000-0000-4000-8000-000000000001", title: "Exploration: Rheintal Flowline", description: "Complete 1 Flowline.",
  status, ...(status === "active" ? { startedAt: "2026-04-01T10:00:00.000Z" } : {}), objectives
});

const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const stubWorld = async (page: Page) => {
  const calls: { generate: Record<string, unknown>[]; plan: Record<string, unknown>[]; save: Record<string, unknown>[]; start: number } = { generate: [], plan: [], save: [], start: 0 };
  let instances: ReturnType<typeof instance>[] = [];
  // The default World carries only the player's persistent world; opportunities come from Explore.
  await page.route(/\/api\/world\?/, (route) => json(route, { collectibles: [], fartleks: [], explorationRoutes: [], truncated: false }));
  await page.route(/\/api\/world\/explore$/, (route) => json(route, {
    outcome: "discovered", flowlines: opportunities, collectibles: [castle], collectiblesTruncated: false, availableCount: 0,
    summary: { total: 2, byCharacter: { flow: 1, endurance: 1, explore: 0 }, collectibles: 1 },
    // The server clamps a wide viewport to a centered frame and explores only that.
    area: { bbox: "8.300000,47.300000,8.700000,47.700000", center: { lat: 47.5, lon: 8.5 }, clamped: true }
  }));
  await page.route(/\/api\/explorations\/generate$/, (route) => {
    calls.generate.push(route.request().postDataJSON());
    return json(route, {
      explorationId: "e2e-exploration",
      proposals: [proposal("e2e-generated", ["c-castle"])],
      catalog: { collectibles: [castle], flowlines: opportunities },
      truncated: false
    });
  });
  await page.route(/\/api\/explorations\/plan$/, (route) => {
    calls.plan.push(route.request().postDataJSON());
    return json(route, { explorationId: "e2e-exploration", proposal: proposal("e2e-proposal", []) });
  });
  await page.route(/\/api\/explorations\/save$/, (route) => {
    calls.save.push(route.request().postDataJSON());
    instances = [instance("planned")];
    return json(route, { instance: instances[0], plannedRoute: { id: "r1", geometry: routeGeometry, distanceM: 24_000, durationS: 4_200, routeType: "round_trip", start: { lat: 47.5, lon: 8.5 } } });
  });
  await page.route(/\/api\/quest-instances$/, (route) => json(route, { instances }));
  await page.route(/\/api\/quest-instances\/[^/]+\/start$/, (route) => {
    calls.start += 1;
    instances = [instance("active")];
    return json(route, { instance: instances[0] });
  });
  await page.route(/\/api\/world\/quest-targets\?/, (route) => json(route, { collectibles: [], flowlines: [opportunities[0]] }));
  return calls;
};

test.describe("explore this area", () => {
  test.use({ geolocation: { latitude: 47.5, longitude: 8.5 }, permissions: ["geolocation"] });

  test("explores a clamped frame, generates one route for the chosen feel, edits, saves and starts it", async ({ page }) => {
    const calls = await stubWorld(page);
    await page.goto("/world");

    const cta = page.locator("[data-world-explore]");
    await expect(cta).toHaveText("Explore this area");
    await expect(cta).toBeEnabled();
    // The located position is the generated route's start.
    await page.locator("[data-world-locate]").click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("staza.world.home-location"))).not.toBeNull();
    await cta.click();

    const card = page.locator(".world-explore-card.is-reveal");
    await expect(card).toContainText("3 opportunities");
    await expect(card.locator(".world-explore-breakdown")).toContainText("1 high-flow");
    await expect(card.locator(".world-explore-breakdown")).toContainText("1 collectible");
    await expect(card.locator("[data-explore-clamped]")).toBeVisible();

    await card.locator("[data-explore-generate]").click();
    await expect(page.locator('[data-planner-stop="c-castle"]')).toBeVisible();
    await expect(page.locator('[data-planner-stop="flowline:f-rhine"]')).toBeVisible();
    expect(calls.generate).toHaveLength(1);
    expect(calls.generate[0]).toMatchObject({ start: { lat: 47.5, lon: 8.5 }, routeType: "round_trip" });
    expect(calls.generate[0]).not.toHaveProperty("intents");

    // The generated route is directly editable: dropping the castle reroutes after a short pause.
    await page.getByRole("button", { name: "Remove Hill Castle" }).click();
    await expect(page.locator('[data-planner-stop="c-castle"]')).toHaveCount(0);
    await expect.poll(() => calls.plan.length).toBe(1);
    await expect(page.locator("[data-planner-save]")).toBeEnabled();

    await page.locator("[data-planner-save]").click();
    const quests = page.getByRole("region", { name: "Your explorations" });
    await expect(quests.locator(".quest-status-chip")).toHaveText("Planned");
    expect(calls.save).toEqual([{ proposalId: "e2e-proposal" }]);
    expect(calls.start).toBe(0);

    await quests.locator("[data-quest-start]").click();
    await expect(quests.locator(".quest-status-chip")).toHaveText("Started");
    expect(calls.start).toBe(1);
  });
});
