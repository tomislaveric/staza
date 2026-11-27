import { afterEach, describe, expect, it, vi } from "vitest";
import { distanceBetween, mountWorldPage, visibleWorldCollectibles, WorldPage } from "./world-page.js";
import * as worldMap from "./world/world-map.js";

const collectibles = [
  { id: "viewpoint-found", name: "Viewpoint", type: "landmark", primaryCategory: "viewpoint", found: true, latitude: 49, longitude: 8 },
  { id: "peak-unfound", name: "Peak", type: "landmark", primaryCategory: "peak", found: false, latitude: 50, longitude: 9 },
  { id: "castle-found", name: "Castle", type: "landmark", primaryCategory: "castle", found: true, latitude: 51, longitude: 10 }
];
const flowline = { id: "fartlek-1", name: "Harbour Straight", completed: false, geometry: { type: "LineString", coordinates: [[8, 49], [8.01, 49.01]] } };

describe("World page", () => {
  it("is the Explore planner without filters or a separate Explore step", () => {
    const markup = WorldPage();
    expect(markup).toContain(">Explore</h1>");
    expect(markup).not.toContain("data-world-filter");
    expect(markup).not.toContain("data-world-explore");
    expect(markup).toMatch(/class="world-map-frame">[\s\S]*<\/div>\s*<div class="world-detail-host"/);
  });

  it("keeps hidden POIs off the map and measures distance", () => {
    const hidden = { id: "hidden", found: false, latitude: 52, longitude: 11, visibility: "hidden" };
    expect(visibleWorldCollectibles([...collectibles, hidden]).map((item) => item.id)).toEqual(collectibles.map((item) => item.id));
    expect(Math.round(distanceBetween({ latitude: 50, longitude: 9 }, { latitude: 50, longitude: 10 }) / 1000)).toBe(71);
  });
});

describe("mounted World page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const routeGeometry = { type: "LineString", coordinates: [[9, 50], [9.1, 50.1], [9, 50]] };
  const detourGeometry = { type: "LineString", coordinates: [[9, 50], [9.2, 50.1], [9, 50]] };
  const proposal = (id, overrides = {}) => ({
    id, label: "balanced", distanceM: 42_000, durationS: 6_000, geometry: routeGeometry,
    routeType: "round_trip", start: { lat: 50, lon: 9 }, end: { lat: 50, lon: 9 }, includedTargetIds: [], ...overrides
  });
  const savedInstance = {
    id: "instance-1", templateId: "exploration", templateVersion: 1, title: "Exploration", description: "",
    recommendedLevel: 1, status: "active", startedAt: "2026-04-01T10:00:00.000Z", objectives: []
  };
  const plannedRoute = {
    id: "route-1", questInstanceId: "instance-1", routeType: "round_trip", start: { lat: 50, lon: 9 }, end: { lat: 50, lon: 9 },
    distanceM: 42_000, durationS: 6_000, geometry: routeGeometry, includedTargetIds: []
  };

  /** A host whose elements exist while its markup contains their data attribute; events call the bound handler. */
  const fakeHost = (base) => {
    base.datasets = {};
    base.bound = {};
    const matches = (selector) => new RegExp(`${selector.slice(1, -1)}(?![\\w-])`).test(base.innerHTML);
    const element = (selector) => ({
      get dataset() { return base.datasets[selector] ?? {}; },
      addEventListener(event, handler) {
        base.bound[`${selector}:${event}`] = (domEvent) => handler(domEvent ?? { currentTarget: this, target: { closest: () => null } });
      }
    });
    base.querySelectorAll = (selector) => matches(selector) ? [element(selector)] : [];
    base.querySelector = (selector) => matches(selector) ? element(selector) : undefined;
    return base;
  };

  const mount = async ({ savedHome, instances = [], generated = {}, planFails = false } = {}) => {
    let savedHomeValue = savedHome ? JSON.stringify(savedHome) : null;
    const localStorage = { getItem: vi.fn(() => savedHomeValue), setItem: vi.fn((_key, value) => { savedHomeValue = value; }) };
    vi.stubGlobal("localStorage", localStorage);
    const element = () => ({
      innerHTML: "", hidden: false, textContent: "", handlers: {},
      addEventListener(event, handler) { this.handlers[event] = handler; },
      querySelector: () => undefined,
      querySelectorAll: () => []
    });
    const hosts = Object.fromEntries(["map", "status", "stats", "quests", "detail", "collectible-list", "locate", "aim"]
      .map((name) => [`[data-world-${name}]`, element()]));
    const detail = fakeHost(hosts["[data-world-detail]"]);
    const quests = fakeHost(hosts["[data-world-quests]"]);
    const mountPoint = { innerHTML: "", querySelector: (selector) => hosts[selector], querySelectorAll: () => [] };
    let activeInstances = instances;
    let snapshot = { collectibles, truncated: false, explorationRoutes: [] };
    const fetchMock = vi.fn(async (url, options) => {
      let body;
      if (url === "/api/world/basemap") body = { styleUrl: "/style.json" };
      else if (url === "/api/quest-instances") body = { instances: activeInstances };
      else if (url.startsWith("/api/world?bbox=")) body = snapshot;
      else if (url === "/api/explorations/generate") {
        body = {
          explorationId: "exp-1",
          proposals: [proposal("baseline", generated.includedTargetIds ? { includedTargetIds: generated.includedTargetIds } : {})],
          catalog: { collectibles, flowlines: [flowline] },
          flowlineEnhancements: [{ flowline, rationale: "A flow ride close to your route." }],
          nearbyCollectibles: [{ collectible: collectibles[1], distanceM: 400 }]
        };
      } else if (url === "/api/explorations/plan") {
        if (planFails) return { ok: false, status: 422, json: async () => ({ error: "No route was found.", code: "no_route" }) };
        body = { explorationId: "plan-1", proposal: proposal("planned") };
      } else if (url === "/api/explorations/exp-1/reroute") {
        if (planFails) return { ok: false, status: 422, json: async () => ({ error: "No route was found.", code: "no_route" }) };
        body = {
          proposal: proposal("detour", { geometry: detourGeometry }),
          nearbyCollectibles: [{ collectible: { ...collectibles[2], id: "lake-new", name: "Lake", found: false }, distanceM: 300 }]
        };
      }
      else if (url === "/api/explorations/exp-1/enhance") {
        body = { proposal: proposal("enhanced"), metrics: { distanceDeltaM: 1200, durationDeltaS: 300, elevationGainDeltaM: 80 }, flowlineIds: ["fartlek-1"] };
      } else if (url === "/api/explorations/save") {
        activeInstances = [savedInstance];
        body = { instance: savedInstance, plannedRoute };
      } else if (url === "/api/quest-instances/instance-1" && options?.method === "DELETE") activeInstances = [];
      else throw new Error(`Unexpected fetch: ${url}`);
      return { ok: true, json: async () => body };
    });
    vi.stubGlobal("fetch", fetchMock);
    const map = {
      getBounds: () => ({ west: 8, south: 49, east: 11, north: 52 }),
      getView: () => ({ center: { lat: 50.5, lon: 9.5 }, zoom: 8 }),
      setCollectibles: vi.fn(), setFartleks: vi.fn(), setDetailPanelOpen: vi.fn(), setRoute: vi.fn(), setSavedRoutes: vi.fn(),
      fitTo: vi.fn(), setRouteEndpoints: vi.fn(), setPickHandler: vi.fn(), setMapClickHandler: vi.fn(),
      setHomePosition: vi.fn(), flyTo: vi.fn()
    };
    const createMap = vi.spyOn(worldMap, "createWorldMap").mockResolvedValue(map);
    await mountWorldPage(mountPoint);
    const click = (selector, dataset) => {
      if (dataset) detail.datasets[selector] = dataset;
      detail.bound[`${selector}:click`]();
    };
    const page = {
      detail, quests, map, fetchMock, mountPoint, localStorage,
      status: hosts["[data-world-status]"],
      aim: hosts["[data-world-aim]"],
      callbacks: createMap.mock.calls[0][1],
      click,
      change: (selector, dataset) => {
        detail.datasets[selector] = dataset;
        detail.bound[`${selector}:change`]();
      },
      choose: async (sport = "cycling", shape = "round_trip") => {
        click("[data-planner-sport]", { plannerSport: sport });
        click("[data-planner-shape]", { plannerShape: shape });
      },
      generate: async (sport, shape) => {
        await page.choose(sport, shape);
        await vi.waitFor(() => expect(detail.innerHTML).toContain("data-planner-save"));
      },
      calls: (url) => fetchMock.mock.calls.filter(([calledUrl]) => calledUrl === url),
      body: (url, index = 0) => JSON.parse(page.calls(url)[index][1].body),
      collectibleFeature: (id) => map.setCollectibles.mock.lastCall[0].features.find((feature) => feature.id === id),
      fartlekIds: () => map.setFartleks.mock.lastCall[0].features.map((feature) => feature.id),
      setSnapshot: (next) => { snapshot = next; }
    };
    await vi.waitFor(() => expect(map.setCollectibles).toHaveBeenCalled());
    return page;
  };

  it("opens straight into the planner with POIs and no Flowlines on the map", async () => {
    const page = await mount({ savedHome: { latitude: 50, longitude: 9 } });
    expect(page.detail.innerHTML).toContain('aria-label="Explore"');
    expect(page.detail.innerHTML).toContain('data-planner-sport="cycling"');
    expect(page.collectibleFeature("peak-unfound")).toBeDefined();
    expect(page.fartlekIds()).toEqual([]);
    expect(page.aim.hidden).toBe(false);
    expect(page.calls("/api/player/capabilities")).toHaveLength(0);
    expect(page.map.setMapClickHandler).toHaveBeenLastCalledWith(undefined);
  });

  it("generates a baseline towards the map center and offers optional Flowlines and nearby POIs", async () => {
    const page = await mount({ savedHome: { latitude: 50, longitude: 9 } });
    await page.generate();
    expect(page.body("/api/explorations/generate")).toEqual({
      start: { lat: 50, lon: 9 }, sport: "cycling", routeType: "round_trip", target: { lat: 50.5, lon: 9.5 }
    });
    expect(page.aim.hidden).toBe(true);
    expect(page.map.setRoute).toHaveBeenLastCalledWith({ geometry: routeGeometry }, { planned: true });
    expect(page.detail.innerHTML).toContain('data-planner-enhancement="fartlek-1"');
    expect(page.fartlekIds()).toEqual(["fartlek-1"]);
    expect(page.detail.innerHTML).toContain('data-planner-nearby="peak-unfound"');

    page.callbacks.onFartlekSelect("fartlek-1");
    await vi.waitFor(() => expect(page.detail.innerHTML).toContain("Compared with baseline"));
    expect(page.body("/api/explorations/exp-1/enhance")).toEqual({ proposalId: "baseline", flowlineIds: ["fartlek-1"] });

    page.change("[data-planner-nearby]", { plannerNearby: "peak-unfound" });
    expect(page.detail.innerHTML).toContain('data-planner-stop="peak-unfound"');
    expect(page.fartlekIds(), "own edits route without optional Flowlines").toEqual([]);
    await vi.waitFor(() => expect(page.calls("/api/explorations/exp-1/reroute")).toHaveLength(1), { timeout: 2000 });
    expect(page.body("/api/explorations/exp-1/reroute"), "added POIs detour from the baseline")
      .toEqual({ proposalId: "baseline", targetIds: ["peak-unfound"], waypoints: [] });
    expect(page.calls("/api/explorations/plan")).toHaveLength(0);
    expect(page.map.setRoute).toHaveBeenLastCalledWith({ geometry: detourGeometry }, { planned: true });
    expect(page.detail.innerHTML, "the changed route brings its own nearby POIs").toContain('data-planner-nearby="lake-new"');
    expect(page.detail.innerHTML, "a chosen POI leaves the nearby list").not.toContain('data-planner-nearby="peak-unfound"');

    const callsBefore = page.fetchMock.mock.calls.length;
    page.click("[data-planner-remove]", { plannerRemove: "0" });
    expect(page.fetchMock.mock.calls.length, "removing the added POI restores the baseline locally").toBe(callsBefore);
    expect(page.map.setRoute).toHaveBeenLastCalledWith({ geometry: routeGeometry }, { planned: true });
    expect(page.detail.innerHTML).not.toContain('data-planner-stop="peak-unfound"');
    expect(page.detail.innerHTML).toContain('data-planner-enhancement="fartlek-1"');
    expect(page.detail.innerHTML).toContain("data-planner-save");
    expect(page.detail.innerHTML, "the baseline's nearby POIs return").toContain('data-planner-nearby="peak-unfound"');
    expect(page.detail.innerHTML).not.toContain('data-planner-nearby="lake-new"');
  });

  it("highlights a hovered nearby POI or Flowline on the map", async () => {
    const page = await mount({ savedHome: { latitude: 50, longitude: 9 } });
    await page.generate();
    expect(page.detail.innerHTML).toContain('<button type="button" data-planner-locate class="is-set"');
    expect(page.detail.innerHTML, "the start shows no coordinates").not.toContain("50.0000");
    page.detail.datasets["[data-planner-hover]"] = { plannerHover: "collectible:peak-unfound" };
    page.detail.bound["[data-planner-hover]:mouseenter"]();
    expect(page.collectibleFeature("peak-unfound").properties.selected).toBe(true);
    page.detail.bound["[data-planner-hover]:mouseleave"]();
    expect(page.collectibleFeature("peak-unfound").properties.selected).toBe(false);
    page.callbacks.onFartlekHover("fartlek-1");
    expect(page.map.setFartleks.mock.lastCall[0].features[0].properties.selected).toBe(true);
    page.callbacks.onFartlekHover(undefined);
    expect(page.map.setFartleks.mock.lastCall[0].features[0].properties.selected).toBe(false);
  });

  it("keeps the last route when an added stop cannot be routed", async () => {
    const page = await mount({ savedHome: { latitude: 50, longitude: 9 }, planFails: true });
    await page.generate();
    page.change("[data-planner-nearby]", { plannerNearby: "peak-unfound" });
    await vi.waitFor(() => expect(page.detail.innerHTML).toContain("No route was found."), { timeout: 2000 });
    expect(page.detail.innerHTML).not.toContain('data-planner-stop="peak-unfound"');
    expect(page.detail.innerHTML).toContain("data-planner-save");
    expect(page.detail.innerHTML).toContain('data-planner-enhancement="fartlek-1"');
    expect(page.map.setRoute).toHaveBeenLastCalledWith({ geometry: routeGeometry }, { planned: true });
  });

  it("routes to a selected POI, then adds other POIs and map points as stops", async () => {
    const page = await mount({ savedHome: { latitude: 50, longitude: 9 }, generated: { includedTargetIds: ["castle-found", "peak-unfound"] } });
    page.callbacks.onCollectibleSelect("castle-found");
    expect(page.detail.innerHTML).toContain('data-collectible-route="castle-found">Route here<');
    page.detail.bound["[data-collectible-route]:click"]();
    expect(page.detail.innerHTML).toContain("Destination");
    expect(page.detail.innerHTML).toContain("Castle");
    expect(page.aim.hidden).toBe(true);
    await page.generate("hiking");
    expect(page.body("/api/explorations/generate")).toMatchObject({ sport: "hiking", target: { lat: 51, lon: 10 }, destinationId: "castle-found" });
    expect(page.detail.innerHTML).toContain('data-planner-stop="castle-found"');
    expect(page.detail.innerHTML, "only the chosen destination becomes a stop").not.toContain('data-planner-stop="peak-unfound"');
    expect(page.detail.innerHTML, "optional Flowlines are cycling-only").not.toContain("data-planner-enhancement");

    page.callbacks.onCollectibleSelect("viewpoint-found");
    expect(page.detail.innerHTML).toContain(">Add to route<");
    page.detail.bound["[data-collectible-route]:click"]();
    page.map.setMapClickHandler.mock.lastCall[0]({ lat: 50.3, lon: 9.3 });
    expect(page.collectibleFeature("viewpoint-found").properties.questTarget).toBe(true);
    await vi.waitFor(() => expect(page.calls("/api/explorations/exp-1/reroute")).toHaveLength(1), { timeout: 2000 });
    expect(page.body("/api/explorations/exp-1/reroute")).toEqual({
      proposalId: "baseline", targetIds: ["castle-found", "viewpoint-found"], waypoints: [{ lat: 50.3, lon: 9.3 }]
    });
  });

  it("asks for a start before generating when none is known, and Locate sets it", async () => {
    const page = await mount();
    await page.choose();
    expect(page.detail.innerHTML).toContain("Click the map to set your start.");
    expect(page.calls("/api/explorations/generate")).toHaveLength(0);
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: (success) => success({ coords: { latitude: 50.1, longitude: 9.1 } }) } });
    page.mountPoint.querySelector("[data-world-locate]").handlers.click();
    await vi.waitFor(() => expect(page.calls("/api/explorations/generate")).toHaveLength(1));
    expect(page.body("/api/explorations/generate")).toMatchObject({ start: { lat: 50.1, lon: 9.1 } });
    expect(JSON.parse(page.localStorage.setItem.mock.lastCall[1])).toEqual({ latitude: 50.1, longitude: 9.1 });
    expect(page.map.flyTo).toHaveBeenCalledWith(9.1, 50.1, worldMap.homeScaleZoom(50.1));
  });

  it("keeps the saved home when location permission is denied", async () => {
    const page = await mount({ savedHome: { latitude: 50.2, longitude: 9.2 } });
    expect(page.callbacks.homePosition).toEqual({ latitude: 50.2, longitude: 9.2 });
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: (_success, failure) => failure() } });
    page.mountPoint.querySelector("[data-world-locate]").handlers.click();
    expect(page.localStorage.setItem).not.toHaveBeenCalled();
    expect(page.status.textContent).toContain("Location permission was denied");
  });

  it("saves only on request as an active Exploration and starts over without persisting", async () => {
    const page = await mount({ savedHome: { latitude: 50, longitude: 9 } });
    await page.generate();
    expect(page.quests.innerHTML, "saved routes are listed only while nothing is planned").toBe("");
    const callsBefore = page.fetchMock.mock.calls.length;
    page.click("[data-planner-reset]");
    expect(page.fetchMock.mock.calls.length).toBe(callsBefore);
    expect(page.detail.innerHTML).not.toContain("data-planner-save");
    expect(page.map.setRoute).toHaveBeenLastCalledWith(undefined, { planned: true });

    await page.generate();
    page.click("[data-planner-save]");
    await vi.waitFor(() => expect(page.quests.innerHTML).toContain('data-quest-delete="instance-1"'));
    expect(page.body("/api/explorations/save")).toEqual({ proposalId: "baseline" });
    expect(page.quests.innerHTML, "an Exploration in progress has no status label").not.toContain("quest-status-chip");
    expect(page.quests.innerHTML).not.toContain("Start Exploration");
    expect(page.map.setSavedRoutes).toHaveBeenLastCalledWith([expect.objectContaining({ id: "instance-1", geometry: routeGeometry })]);
    expect(page.map.setRoute).toHaveBeenLastCalledWith({ geometry: routeGeometry });
  });

  it("confirms deletion and removes the saved Exploration and its route", async () => {
    const page = await mount({ savedHome: { latitude: 50, longitude: 9 } });
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    await page.generate();
    page.click("[data-planner-save]");
    await vi.waitFor(() => expect(page.quests.innerHTML).toContain('data-quest-delete="instance-1"'));
    page.quests.datasets["[data-quest-delete]"] = { questDelete: "instance-1" };
    page.quests.bound["[data-quest-delete]:click"]();
    await vi.waitFor(() => expect(page.quests.innerHTML).toContain("Pick a place, generate a route"));
    expect(page.map.setSavedRoutes).toHaveBeenLastCalledWith([]);
    expect(page.map.setRoute).toHaveBeenLastCalledWith(undefined, { planned: true });
  });

  it("draws the saved Exploration routes the World snapshot returns", async () => {
    const page = await mount();
    page.setSnapshot({ collectibles, explorationRoutes: [{ id: "saved-1", title: "Loop", status: "completed", geometry: routeGeometry }] });
    page.callbacks.onViewportChange({ west: 30, south: 49, east: 33, north: 52 });
    await vi.waitFor(() => expect(page.map.setSavedRoutes).toHaveBeenLastCalledWith([expect.objectContaining({ id: "saved-1" })]));
  });
});
