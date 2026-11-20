import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Explore → reveal → plan with stubbed World data, so the flow does not depend on which Flowlines
 * the test player has already revealed. The real page, map and client logic run unchanged.
 */
const line = (lon: number) => ({ type: "LineString", coordinates: [[lon, 47.5], [lon + 0.02, 47.51]] });
const flowline = (id: string, name: string, lon: number, character: "flow" | "endurance") => ({
  id, name, geometry: line(lon), completed: false, lengthMeters: 3800,
  flowScore: character === "flow" ? 84 : 55, enduranceScore: character === "endurance" ? 80 : 40, roadQualityScore: 91,
  character: { primary: character, tags: [character] }
});
const revealed = [flowline("f-rhine", "Rheintal Flowline", 8.5, "flow"), flowline("f-hills", "Hill Loop", 8.55, "endurance")];

const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const stubWorld = async (page: Page) => {
  const planBodies: Record<string, unknown>[] = [];
  // The viewport only carries completed Flowlines; revealed ones come from Explore.
  await page.route(/\/api\/world\?/, (route) => json(route, { collectibles: [], fartleks: [], truncated: false, exploreAllowed: true }));
  await page.route(/\/api\/world\/explore$/, (route) => {
    return json(route, {
      outcome: "discovered", revealed, known: revealed, knownCount: 2, availableCount: 0,
      summary: { total: 2, byCharacter: { flow: 1, endurance: 1, explore: 0 } }
    });
  });
  await page.route(/\/api\/explorations\/plan$/, (route) => {
    planBodies.push(route.request().postDataJSON());
    return json(route, {
      explorationId: "e2e-exploration",
      proposal: {
        id: "e2e-proposal", label: "balanced", recommended: true, distanceM: 24_000, durationS: 4_200,
        geometry: { type: "LineString", coordinates: [[8.5, 47.5], [8.52, 47.51], [8.5, 47.5]] },
        start: { lat: 47.5, lon: 8.5 }, includedTargetIds: [], flowlineIds: ["f-rhine"], stopOrder: ["flowline:f-rhine"]
      }
    });
  });
  return planBodies;
};

test.describe("explore this area", () => {
  test.use({ geolocation: { latitude: 47.5, longitude: 8.5 }, permissions: ["geolocation"] });

  test("reveals Flowlines, lists discoveries and plans a route only through chosen stops", async ({ page }) => {
    const planBodies = await stubWorld(page);
    await page.goto("/world");

    const cta = page.locator("[data-world-explore]");
    await expect(cta).toHaveText("Explore this area");
    await expect(cta).toBeEnabled();
    await cta.click();

    const card = page.locator(".world-explore-card.is-reveal");
    await expect(card).toContainText("2 Flowlines discovered");
    await expect(card.locator(".world-explore-breakdown")).toContainText("1 high-flow");
    await expect(card.locator(".world-explore-breakdown")).toContainText("1 endurance");
    await expect(cta).toHaveText("Explore this area");

    await card.locator("[data-explore-discoveries]").click();
    const discoveries = page.getByRole("region", { name: "Discovered in this area" });
    await expect(discoveries.locator("[data-discovery]")).toHaveCount(2);
    await expect(discoveries.locator("[data-discovery]").first()).toContainText("Rheintal Flowline");
    await discoveries.locator('[data-flowline-add-route="f-rhine"]').click();
    await expect(discoveries.locator('[data-flowline-add-route="f-rhine"]')).toHaveText("Added to route");

    await discoveries.locator("[data-discoveries-plan]").click();
    await expect(page.locator('[data-planner-stop="flowline:f-rhine"]')).toBeVisible();
    await page.locator("[data-planner-locate]").click();
    await page.locator("[data-planner-route]").click();

    await expect(page.locator("[data-planner-result]")).toContainText("Start Exploration");
    expect(planBodies).toHaveLength(1);
    expect(planBodies[0]).toMatchObject({
      routeType: "round_trip",
      start: { lat: 47.5, lon: 8.5 },
      stops: [{ kind: "flowline", id: "f-rhine" }]
    });
  });
});
