import { getAppLocale } from "../app-locales.js";
import { escapeHtml } from "./collected-list.js";
import { markerLabel } from "./world/world-markers.js";
import { collectiblesToFeatureCollection } from "./world/collectible-features.js";
import { fartleksToFeatureCollection } from "./world/fartlek-features.js";
import { boundsToParameter, createWorldMap, homeScaleZoom } from "./world/world-map.js";
import { readHomeLocation, saveHomeLocation } from "./world/home-location.js";
import { boundsContain, expandBounds, isServedByLoadedArea, scaleBounds } from "./shared/map/staza-map-utils.js";
import { QuestList } from "./world/quest-list.js";
import { CollectibleDetail } from "./world/collectible-detail.js";
import {
  buildPlanRequest, buildSuggestRequest, canEditStops, canGenerate, collectibleStop, createPlannerState, hasStop, isFresh,
  moveStop, orderStops, riddenFlowlines, routeEdit, RoutePlannerPanel, showsAim, showsFlowlineEnhancements, stepsDone, suggestedStops, toggleStop, waypointStop
} from "./world/route-planner.js";

/**
 * World is Explore: one destination-first route planner over a map of curated POIs. Flowlines are
 * not part of the map; a generated cycling route offers nearby ones as optional enhancements.
 */

export const visibleWorldCollectibles = (collectibles) =>
  collectibles.filter((collectible) => collectible.visibility !== "hidden");

/** Only a hint when the viewport is capped; per-viewport counts are not shown. */
export const WorldStats = (truncated) => truncated
  ? '<p class="world-stats"><span class="world-stats-truncated">Zoom in to see everything here</span></p>'
  : "";

export const WorldPage = () => `
  <section class="world-page" aria-labelledby="world-title">
    <header class="world-header">
      <div>
        <h1 id="world-title">Explore</h1>
        <p>Pick a place, get a route</p>
      </div>
    </header>
    <div class="world-map-shell">
      <div class="world-map-frame">
        <div class="world-map staza-map" data-world-map></div>
        <span class="world-map-aim" data-world-aim aria-hidden="true" hidden></span>
        <ul class="world-collectible-list" aria-label="Places on the map" data-world-collectible-list></ul>
        <a class="world-osm-attribution" href="https://www.openstreetmap.org/copyright"
          target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>
        <div class="world-map-actions">
          <button class="world-locate" type="button" data-world-locate>LOCATE ME</button>
        </div>
        <p class="world-map-status" data-world-status role="status" hidden></p>
      </div>
      <div class="world-detail-host" data-world-detail></div>
    </div>
    <div data-world-stats></div>
    <div data-world-quests></div>
  </section>
`;

const responseJson = async (response) => {
  if (response.status === 204) return undefined;
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error ?? "Unable to load World data.");
    error.code = body.code;
    throw error;
  }
  return body;
};

const geometryPoints = (geometry) => geometry.coordinates.map(([longitude, latitude]) => ({ latitude, longitude }));

const jsonRequest = (method, url, body) => fetch(url, {
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
}).then(responseJson);

/** A quest's PlannedRoute, or null when it was started without one. */
const loadPlannedRoute = async (instanceId) => {
  const response = await fetch(`/api/quest-instances/${encodeURIComponent(instanceId)}/planned-route`);
  if (response.status === 404) return null;
  return responseJson(response);
};

const EARTH_RADIUS_M = 6_371_000;
const toRadians = (degrees) => degrees * Math.PI / 180;

/** Great-circle distance in metres between two {latitude, longitude} points. */
export const distanceBetween = (from, to) => {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
};

const expiredCodes = new Set(["exploration_expired", "proposal_expired"]);

export const explorationErrorMessage = (error) => {
  if (expiredCodes.has(error.code)) return "This route expired. Route your stops again.";
  return error.message;
};

/** Delay before an edited stop list reroutes, so several quick edits route once. */
const REROUTE_DELAY_MS = 800;

export const mountWorldPage = async (mountPoint) => {
  mountPoint.innerHTML = '<section class="world-page"><p class="world-loading" role="status">Loading World...</p></section>';

  let basemap;
  let questInstances = [];
  try {
    const [loadedBasemap, activeQuests] = await Promise.all([
      fetch("/api/world/basemap").then(responseJson),
      fetch("/api/quest-instances").then(responseJson)
    ]);
    basemap = loadedBasemap;
    questInstances = activeQuests.instances;
  } catch (error) {
    mountPoint.innerHTML = `<section class="world-page"><p class="world-load-error" role="alert">Unable to load World: ${escapeHtml(error.message)}</p></section>`;
    return;
  }

  let collectibles = [];
  let truncated = false;
  /** Every saved Exploration route in view; drawn dotted whatever its status. */
  let explorationRoutes = [];
  /** The tapped POI's id while its detail is shown. */
  let selectionId;
  let selectedQuestKey;
  /** "collectible:<id>" or "flowline:<id>" under the pointer, in the planner list or on the map. */
  let hoveredKey;
  let pendingQuestId;
  let requestToken = 0;
  let questSelectionToken = 0;
  /** Collectible cache: the wide area last loaded, so panning inside it never reloads icons. */
  let loadedArea;
  let worldMap;
  let homePosition;
  let planner;
  let plannerToken = 0;
  let rerouteTimer;
  /** The last route that routed, restored when a stop edit cannot be routed. */
  let lastRoute;
  const plannedRoutes = new Map();

  mountPoint.innerHTML = WorldPage();
  const mapContainer = mountPoint.querySelector("[data-world-map]");
  const statusHost = mountPoint.querySelector("[data-world-status]");
  const statsHost = mountPoint.querySelector("[data-world-stats]");
  const questHost = mountPoint.querySelector("[data-world-quests]");
  const detailHost = mountPoint.querySelector("[data-world-detail]");
  const collectibleListHost = mountPoint.querySelector("[data-world-collectible-list]");
  const aimHost = mountPoint.querySelector("[data-world-aim]");

  const setStatus = (message) => {
    statusHost.hidden = !message;
    statusHost.textContent = message ?? "";
  };

  const homeStart = () => homePosition ? { lat: homePosition.latitude, lon: homePosition.longitude } : undefined;
  const nearbyCollectibles = () => planner?.nearbyCollectibles.map(({ collectible }) => collectible) ?? [];
  const collectibleById = (id) => collectibles.find((item) => item.id === id) ?? nearbyCollectibles().find((item) => item.id === id);
  const routeCollectibleIds = () => planner.stops.filter((stop) => stop.kind === "collectible").map((stop) => stop.id);
  const selectedInstanceId = () => selectedQuestKey?.startsWith("instance:") ? selectedQuestKey.slice("instance:".length) : undefined;

  /* ---------- Rendering ---------- */

  const mappedCollectibles = () => {
    const shown = visibleWorldCollectibles(collectibles);
    const ids = new Set(shown.map((item) => item.id));
    return [...shown, ...nearbyCollectibles().filter((item) => !ids.has(item.id))];
  };

  function renderMapLayers() {
    if (!worldMap) return;
    const mapped = mappedCollectibles();
    const stopIds = routeCollectibleIds();
    const [hoveredKind, hoveredId] = hoveredKey?.split(/:(.*)/s) ?? [];
    worldMap.setCollectibles(collectiblesToFeatureCollection(mapped, {
      selectedId: hoveredKind === "collectible" ? hoveredId : selectionId,
      questCollectibleIds: stopIds.length ? stopIds : undefined
    }));
    const enhancements = showsFlowlineEnhancements(planner) ? planner.flowlineEnhancements.map(({ flowline }) => flowline) : [];
    const ridden = new Set(riddenFlowlines(planner).map(({ id }) => id));
    enhancements.push(...(planner.catalog?.flowlines ?? [])
      .filter((flowline) => ridden.has(flowline.id) && !enhancements.some(({ id }) => id === flowline.id)));
    worldMap.setFartleks(fartleksToFeatureCollection(enhancements, {
      selectedId: hoveredKind === "flowline" ? hoveredId : undefined,
      questTargetIds: planner.selectedEnhancementIds.length ? planner.selectedEnhancementIds : undefined
    }));
    worldMap.setPickHandler(planner.picking ? pickPlannerPoint : undefined);
    worldMap.setMapClickHandler(canEditStops(planner) && !planner.picking && planner.status === "idle" ? addPlannerWaypoint : undefined);
    const plannedRoute = selectedInstanceId() ? plannedRoutes.get(selectedInstanceId()) : undefined;
    if (!planner.proposal && plannedRoute) {
      worldMap.setRouteEndpoints({ start: plannedRoute.start, end: plannedRoute.routeType === "point_to_point" ? plannedRoute.end : undefined });
      worldMap.setRoute({ geometry: plannedRoute.geometry });
    } else {
      worldMap.setRouteEndpoints({ start: planner.start, end: planner.routeType === "point_to_point" ? planner.end : undefined });
      worldMap.setRoute(planner.proposal ? { geometry: planner.proposal.geometry } : undefined, { planned: true });
    }
    collectibleListHost.innerHTML = mapped.map((collectible) => `
      <li>
        <button type="button" data-world-marker="${escapeHtml(collectible.id)}"
          aria-pressed="${collectible.id === selectionId}" data-user-content>${escapeHtml(markerLabel(collectible))}</button>
      </li>
    `).join("");
    collectibleListHost.querySelectorAll("[data-world-marker]").forEach((button) => {
      button.addEventListener("click", () => selectCollectible(button.dataset.worldMarker));
    });
  }

  function renderDetail() {
    aimHost.hidden = !(showsAim(planner) && planner.status === "idle");
    worldMap?.setDetailPanelOpen(true);
    const collectible = selectionId ? collectibleById(selectionId) : undefined;
    if (collectible) {
      const inRoute = hasStop(planner.stops, collectibleStop(collectible));
      detailHost.innerHTML = CollectibleDetail(collectible, [], {
        distanceMeters: homePosition ? distanceBetween(homePosition, collectible) : undefined,
        locale: getAppLocale(),
        routeLabel: !canEditStops(planner) ? "Route here" : inRoute ? "Remove from route" : "Add to route"
      });
      detailHost.querySelector("[data-world-close]")?.addEventListener("click", () => selectCollectible(undefined));
      detailHost.querySelector("[data-collectible-route]")?.addEventListener("click", () => collectibleRouteAction(collectible));
      return;
    }
    detailHost.innerHTML = RoutePlannerPanel(planner);
    bindPlanner();
  }

  function renderSidePanels() {
    statsHost.innerHTML = WorldStats(truncated);
    questHost.innerHTML = isFresh(planner) ? QuestList(questInstances, pendingQuestId, selectedQuestKey, plannedRoutes) : "";
    const on = (selector, handler) => questHost.querySelectorAll(selector).forEach((element) => element.addEventListener("click", handler));
    questHost.querySelectorAll("[data-quest-delete]").forEach((button) => button.addEventListener("click", () => void deleteQuest(button.dataset.questDelete)));
    questHost.querySelectorAll("[data-quest-select]").forEach((button) => button.addEventListener("click", () => void selectQuest(button.dataset.questSelect)));
    on("[data-quest-card]", (event) => {
      if (event.target.closest("button")) return;
      void selectQuest(event.currentTarget.dataset.questCard);
    });
  }

  /** Highlights a POI or Flowline on the map and its planner row while either is hovered. */
  function hoverPlannerItem(key) {
    if (key === hoveredKey) return;
    hoveredKey = key;
    renderMapLayers();
    detailHost.querySelectorAll("[data-planner-hover]").forEach((row) => {
      row.classList?.toggle("is-hovered", row.dataset.plannerHover === key);
    });
  }

  function renderAll() {
    renderMapLayers();
    renderDetail();
    renderSidePanels();
  }

  /* ---------- POIs ---------- */

  function selectCollectible(id) {
    selectionId = id && id !== selectionId ? id : undefined;
    renderMapLayers();
    renderDetail();
  }

  /** Before a route exists a POI becomes the destination; afterwards it is added or removed as a stop. */
  function collectibleRouteAction(collectible) {
    selectionId = undefined;
    if (canEditStops(planner)) {
      editPlannerStops(toggleStop(planner.stops, collectibleStop(collectible)));
      return;
    }
    Object.assign(planner, {
      destination: { lat: collectible.latitude, lon: collectible.longitude },
      destinationId: collectible.id,
      destinationName: collectible.name
    });
    restartGeneration();
  }

  /* ---------- Saved Explorations ---------- */

  async function selectQuest(key) {
    const token = ++questSelectionToken;
    if (selectedQuestKey === key) {
      selectedQuestKey = undefined;
      renderAll();
      return;
    }
    selectedQuestKey = key;
    renderAll();
    const instanceId = selectedInstanceId();
    if (!instanceId) return;
    try {
      if (!plannedRoutes.has(instanceId)) plannedRoutes.set(instanceId, await loadPlannedRoute(instanceId));
      if (token !== questSelectionToken) return;
      renderAll();
      const route = plannedRoutes.get(instanceId);
      if (route) worldMap.fitTo(geometryPoints(route.geometry));
    } catch (error) {
      if (token !== questSelectionToken) return;
      selectedQuestKey = undefined;
      renderAll();
      setStatus(error.message);
    }
  }

  const reloadQuestInstances = async () => {
    questInstances = (await fetch("/api/quest-instances").then(responseJson)).instances;
  };

  /** Deletes a saved Exploration of any status; its route leaves the map. XP already earned stays. */
  async function deleteQuest(instanceId) {
    if (pendingQuestId || !globalThis.confirm(
      "Delete this exploration and its route? XP you already earned is kept. This cannot be undone."
    )) return;
    pendingQuestId = instanceId;
    renderSidePanels();
    try {
      await fetch(`/api/quest-instances/${encodeURIComponent(instanceId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" }
      }).then(responseJson);
      await reloadQuestInstances();
      plannedRoutes.delete(instanceId);
      explorationRoutes = explorationRoutes.filter((route) => route.id !== instanceId);
      worldMap?.setSavedRoutes(explorationRoutes);
      if (selectedInstanceId() === instanceId) selectedQuestKey = undefined;
    } catch (error) {
      setStatus(error.message);
    } finally {
      pendingQuestId = undefined;
      renderAll();
    }
  }

  /* ---------- Planner ---------- */

  /** Starts over from the start point; nothing was saved. */
  function resetPlanner() {
    plannerToken += 1;
    lastRoute = undefined;
    clearTimeout(rerouteTimer);
    selectionId = undefined;
    planner = createPlannerState({ start: planner?.start ?? homeStart() });
    renderAll();
  }

  function pickPlannerPoint(point) {
    if (!planner.picking) return;
    if (planner.picking === "end") planner.end = point;
    else planner.start = point;
    planner.picking = undefined;
    planner.error = undefined;
    endpointChanged();
  }

  /** A new start or end reroutes an existing route; before that it (re)generates the route. */
  function endpointChanged() {
    lastRoute = undefined;
    if (planner.generated || planner.proposal) {
      planner.proposal = undefined;
      if (planner.stops.length) scheduleReroute(0);
      renderAll();
      return;
    }
    restartGeneration();
  }

  /**
   * Drops the generated route and generates again when possible.
   * The player's own stops are never replaced: they are routed again instead.
   */
  function restartGeneration() {
    lastRoute = undefined;
    if (planner.stops.length && !planner.stopsAreSuggested) {
      const wasRouted = Boolean(planner.generated || planner.proposal);
      planner.proposal = undefined;
      if (wasRouted) scheduleReroute(0);
      renderAll();
      return;
    }
    plannerToken += 1;
    clearTimeout(rerouteTimer);
    Object.assign(planner, {
      stops: [], status: "idle", generated: false, proposal: undefined, catalog: undefined,
      rerouteQueued: false, stopsAreSuggested: false, error: undefined
    });
    if (stepsDone(planner) && !planner.start) planner.picking = "start";
    renderAll();
    if (canGenerate(planner) && !planner.picking) void generatePlannerRoute();
  }

  /** Every stop edit after a route exists reroutes after a short delay; earlier edits only change the list. */
  function editPlannerStops(stops, { keepOrder } = {}) {
    const wasRouted = Boolean(planner.generated || planner.proposal);
    if (planner.proposal) {
      const { stops: routedStops, proposal, stopsAreSuggested, selectedEnhancementIds, enhancementMetrics, keepOrder: routedOrder } = planner;
      lastRoute = { stops: routedStops, proposal, stopsAreSuggested, selectedEnhancementIds, enhancementMetrics, keepOrder: routedOrder };
    }
    Object.assign(planner, {
      stops,
      proposal: undefined,
      selectedEnhancementIds: [],
      enhancementMetrics: undefined,
      stopsAreSuggested: false,
      error: undefined,
      ...(keepOrder === undefined ? {} : { keepOrder })
    });
    if (wasRouted && routeEdit(planner).kind === "baseline") restoreBaseline();
    else if (wasRouted && stops.length) scheduleReroute(REROUTE_DELAY_MS);
    else {
      clearTimeout(rerouteTimer);
      planner.rerouteQueued = false;
    }
    renderAll();
  }

  /** Removing every added stop brings back the generated route and its optional Flowlines. */
  function restoreBaseline() {
    clearTimeout(rerouteTimer);
    lastRoute = undefined;
    Object.assign(planner, {
      proposal: planner.baselineProposal,
      nearbyCollectibles: planner.baselineNearbyCollectibles,
      stops: suggestedStops(planner.baselineProposal, planner.catalog, planner.destinationId),
      stopsAreSuggested: true,
      keepOrder: false,
      selectedEnhancementIds: [],
      enhancementMetrics: undefined,
      rerouteQueued: false,
      error: undefined
    });
  }

  function scheduleReroute(delayMs) {
    clearTimeout(rerouteTimer);
    planner.rerouteQueued = true;
    rerouteTimer = setTimeout(() => {
      planner.rerouteQueued = false;
      void routePlanner();
    }, delayMs);
  }

  function addPlannerWaypoint(point) {
    if (!canEditStops(planner) || planner.status !== "idle") return;
    editPlannerStops(toggleStop(planner.stops, waypointStop(point)));
  }

  /** Detours the generated route to added stops, or connects exactly the chosen stops. */
  async function routePlanner() {
    if (planner.status !== "idle") return;
    const edit = routeEdit(planner);
    if (edit.kind === "baseline") {
      restoreBaseline();
      renderAll();
      return;
    }
    const { body, error } = buildPlanRequest(planner);
    if (error) {
      planner.error = error;
      renderDetail();
      return;
    }
    const token = ++plannerToken;
    Object.assign(planner, { status: "routing", picking: undefined, error: undefined, rerouteQueued: false });
    renderAll();
    try {
      let result;
      if (edit.kind === "reroute") {
        try {
          result = await jsonRequest("POST", `/api/explorations/${encodeURIComponent(planner.explorationId)}/reroute`, edit.body);
        } catch {
          // An expired exploration or a stop the detour cannot reach still gets a fresh route.
          if (token !== plannerToken) return;
        }
      }
      result ??= await jsonRequest("POST", "/api/explorations/plan", body);
      if (token !== plannerToken) return;
      lastRoute = undefined;
      Object.assign(planner, {
        status: "idle",
        proposal: result.proposal,
        nearbyCollectibles: result.nearbyCollectibles ?? planner.nearbyCollectibles,
        stops: planner.keepOrder ? planner.stops : orderStops(planner.stops, result.proposal.stopOrder)
      });
      if (!planner.generated) worldMap.fitTo(geometryPoints(result.proposal.geometry));
    } catch (routeError) {
      if (token !== plannerToken) return;
      // Keep the last working route: a stop that cannot be routed must not wipe it.
      Object.assign(planner, lastRoute ?? {}, { status: "idle", error: explorationErrorMessage(routeError) });
      lastRoute = undefined;
    }
    renderAll();
  }

  /** Generates one baseline route towards the chosen POI or the aim (the map center). */
  async function generatePlannerRoute() {
    if (planner.status !== "idle") return;
    const { body, error } = buildSuggestRequest(planner, planner.destination ?? worldMap.getView().center);
    if (error) {
      planner.error = error;
      renderDetail();
      return;
    }
    const token = ++plannerToken;
    clearTimeout(rerouteTimer);
    Object.assign(planner, {
      status: "generating", picking: undefined, error: undefined, generated: false, stops: [],
      proposal: undefined, baselineProposal: undefined, explorationId: undefined, flowlineEnhancements: [],
      selectedEnhancementIds: [], enhancementMetrics: undefined, nearbyCollectibles: [], baselineNearbyCollectibles: [],
      stopsAreSuggested: false, rerouteQueued: false
    });
    selectedQuestKey = undefined;
    if (planner.routeType === "point_to_point" && !planner.end) planner.end = body.target;
    renderAll();
    try {
      const result = await jsonRequest("POST", "/api/explorations/generate", body);
      if (token !== plannerToken) return;
      const [route] = result.proposals ?? [];
      if (!route) throw new Error("No route could be generated here. Move the map or pick another place.");
      Object.assign(planner, {
        status: "idle",
        generated: true,
        proposal: route,
        baselineProposal: route,
        explorationId: result.explorationId,
        flowlineEnhancements: result.flowlineEnhancements ?? [],
        nearbyCollectibles: result.nearbyCollectibles ?? [],
        baselineNearbyCollectibles: result.nearbyCollectibles ?? [],
        catalog: result.catalog,
        stops: suggestedStops(route, result.catalog, planner.destinationId),
        stopsAreSuggested: true,
        keepOrder: false
      });
      worldMap.fitTo(geometryPoints(route.geometry));
    } catch (generateError) {
      if (token !== plannerToken) return;
      Object.assign(planner, { status: "idle", error: explorationErrorMessage(generateError) });
    }
    renderAll();
  }

  /** Optional Flowlines: every combination is rerouted from the baseline and compared with it. */
  async function toggleFlowlineEnhancement(id, checked) {
    if (planner.status !== "idle" || !planner.baselineProposal || !planner.explorationId) return;
    const selectedEnhancementIds = checked
      ? [...new Set([...planner.selectedEnhancementIds, id])]
      : planner.selectedEnhancementIds.filter((item) => item !== id);
    const token = ++plannerToken;
    Object.assign(planner, { status: "routing", error: undefined, selectedEnhancementIds });
    renderAll();
    try {
      const result = await jsonRequest("POST", `/api/explorations/${encodeURIComponent(planner.explorationId)}/enhance`, {
        proposalId: planner.baselineProposal.id,
        flowlineIds: selectedEnhancementIds
      });
      if (token !== plannerToken) return;
      Object.assign(planner, {
        status: "idle", proposal: result.proposal, enhancementMetrics: result.metrics,
        nearbyCollectibles: result.nearbyCollectibles ?? planner.nearbyCollectibles
      });
    } catch (error) {
      if (token !== plannerToken) return;
      Object.assign(planner, {
        status: "idle",
        selectedEnhancementIds: planner.selectedEnhancementIds.filter((item) => item !== id),
        error: explorationErrorMessage(error)
      });
    }
    renderAll();
  }

  /** "Save Exploration": the only persistence step. */
  async function savePlan() {
    if (!planner.proposal || planner.status !== "idle") return;
    const token = ++plannerToken;
    Object.assign(planner, { status: "saving", error: undefined });
    renderDetail();
    try {
      const { instance, plannedRoute } = await jsonRequest("POST", "/api/explorations/save", { proposalId: planner.proposal.id });
      if (token !== plannerToken) return;
      plannedRoutes.set(instance.id, plannedRoute ?? null);
      if (plannedRoute?.geometry && !explorationRoutes.some((route) => route.id === instance.id)) {
        explorationRoutes = [...explorationRoutes, { id: instance.id, title: instance.title, status: instance.status, geometry: plannedRoute.geometry }];
        worldMap.setSavedRoutes(explorationRoutes);
      }
      await reloadQuestInstances();
      resetPlanner();
      await selectQuest(`instance:${instance.id}`);
    } catch (saveError) {
      if (token !== plannerToken) return;
      Object.assign(planner, {
        status: "idle",
        error: explorationErrorMessage(saveError),
        ...(expiredCodes.has(saveError.code) ? { proposal: undefined } : {})
      });
      renderAll();
    }
  }

  function locate({ fly = false, onDenied } = {}) {
    const geolocation = globalThis.navigator?.geolocation;
    if (!geolocation) {
      onDenied?.("Location is not available in this browser.");
      return;
    }
    geolocation.getCurrentPosition(
      (position) => {
        const location = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        try {
          saveHomeLocation(location);
        } catch (error) {
          setStatus(`Unable to save home location: ${error.message}`);
        }
        homePosition = location;
        worldMap.setHomePosition(location);
        if (fly) worldMap.flyTo(location.longitude, location.latitude, homeScaleZoom(location.latitude));
        if (!planner.start) {
          planner.picking = "start";
          pickPlannerPoint({ lat: location.latitude, lon: location.longitude });
        } else renderAll();
      },
      () => onDenied?.("Location permission was denied.")
    );
  }

  function bindPlanner() {
    const on = (selector, handler) => detailHost.querySelectorAll(selector).forEach((element) => {
      element.addEventListener("click", () => handler(element));
    });
    const idle = (handler) => (element) => {
      if (planner.status === "idle") handler(element);
    };
    on("[data-planner-reset]", () => resetPlanner());
    on("[data-planner-destination-clear]", idle(() => {
      Object.assign(planner, { destination: undefined, destinationId: undefined, destinationName: undefined });
      restartGeneration();
    }));
    on("[data-planner-sport]", idle((button) => {
      const changed = !planner.sportChosen || planner.sport !== button.dataset.plannerSport;
      Object.assign(planner, { sport: button.dataset.plannerSport, sportChosen: true, stepsOpen: !planner.shapeChosen });
      if (changed) restartGeneration();
      else renderAll();
    }));
    on("[data-planner-shape]", idle((button) => {
      const routeType = button.dataset.plannerShape;
      const changed = !planner.shapeChosen || planner.routeType !== routeType;
      Object.assign(planner, { routeType, shapeChosen: true, stepsOpen: !planner.sportChosen });
      if (changed && !(planner.stops.length && !planner.stopsAreSuggested)) planner.end = undefined;
      if (planner.picking === "end") planner.picking = undefined;
      if (changed) restartGeneration();
      else renderAll();
    }));
    on("[data-planner-steps]", idle(() => {
      planner.stepsOpen = true;
      renderAll();
    }));
    on("[data-planner-retry]", idle(() => {
      planner.error = undefined;
      if (planner.stops.length && !planner.stopsAreSuggested) void routePlanner();
      else void generatePlannerRoute();
    }));
    on("[data-planner-pick]", idle((button) => {
      planner.picking = planner.picking === button.dataset.plannerPick ? undefined : button.dataset.plannerPick;
      planner.error = undefined;
      renderAll();
    }));
    on("[data-planner-locate]", () => locate({
      onDenied: (message) => {
        planner.error = `${message} Select your start on the map.`;
        renderDetail();
      }
    }));
    on("[data-planner-move]", idle((button) => {
      const [index, offset] = button.dataset.plannerMove.split(":").map(Number);
      editPlannerStops(moveStop(planner.stops, index, offset), { keepOrder: true });
    }));
    on("[data-planner-remove]", idle((button) => {
      editPlannerStops(planner.stops.filter((_stop, index) => index !== Number(button.dataset.plannerRemove)));
    }));
    on("[data-planner-route]", () => void routePlanner());
    on("[data-planner-save]", () => void savePlan());
    detailHost.querySelectorAll("[data-planner-enhancement]").forEach((input) => {
      input.addEventListener("change", () => void toggleFlowlineEnhancement(input.dataset.plannerEnhancement, input.checked));
    });
    // A re-rendered panel drops the hovered row without a mouseleave.
    if (hoveredKey) {
      hoveredKey = undefined;
      renderMapLayers();
    }
    detailHost.querySelectorAll("[data-planner-hover]").forEach((row) => {
      row.addEventListener("mouseenter", () => hoverPlannerItem(row.dataset.plannerHover));
      row.addEventListener("mouseleave", () => hoverPlannerItem(undefined));
    });
    detailHost.querySelectorAll("[data-planner-nearby]").forEach((input) => {
      input.addEventListener("change", () => {
        const collectible = collectibleById(input.dataset.plannerNearby);
        if (collectible && planner.status === "idle") editPlannerStops(toggleStop(planner.stops, collectibleStop(collectible)));
      });
    });
  }

  /* ---------- Viewport ---------- */

  async function loadViewport(bounds) {
    const token = ++requestToken;
    try {
      const cached = isServedByLoadedArea(loadedArea, bounds);
      // Load twice the viewport (at least 200 km) so zoomed-out maps still get room to pan.
      const area = cached ? undefined : expandBounds(scaleBounds(bounds, 2));
      const query = `bbox=${boundsToParameter(bounds)}`
        + (cached ? "&skipCollectibles=1" : `&collectibleBbox=${boundsToParameter(area)}`);
      const snapshot = await fetch(`/api/world?${query}`).then(responseJson);
      if (token !== requestToken) return;
      if (!cached) {
        loadedArea = { bounds: area, sourceViewport: bounds, truncated: Boolean(snapshot.truncated) };
        // Keep nearby items already shown so a capped reload never makes icons vanish or swap.
        const keep = scaleBounds(area, 1.5);
        const loadedIds = new Set(snapshot.collectibles.map((item) => item.id));
        const retained = collectibles.filter((item) => !loadedIds.has(item.id)
          && boundsContain(keep, { west: item.longitude, east: item.longitude, south: item.latitude, north: item.latitude }));
        collectibles = [...snapshot.collectibles, ...retained];
      }
      truncated = loadedArea.truncated;
      explorationRoutes = snapshot.explorationRoutes ?? [];
      worldMap?.setSavedRoutes(explorationRoutes);
      setStatus(undefined);
      if (selectionId && !collectibleById(selectionId)) selectionId = undefined;
      renderAll();
    } catch (error) {
      if (token !== requestToken) return;
      setStatus(error.message);
    }
  }

  let debounce;
  const scheduleViewportLoad = (bounds) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => void loadViewport(bounds), 250);
  };

  try {
    homePosition = readHomeLocation();
  } catch (error) {
    setStatus(`Unable to load saved home location: ${error.message}`);
  }
  planner = createPlannerState({ start: homeStart() });
  renderDetail();
  renderSidePanels();

  try {
    worldMap = await createWorldMap(mapContainer, {
      styleUrl: basemap.styleUrl,
      attribution: basemap.attribution,
      homePosition,
      onViewportChange: (bounds) => scheduleViewportLoad(bounds),
      onCollectibleSelect: (id) => selectCollectible(id),
      onCollectibleHover: (id) => hoverPlannerItem(id === undefined ? undefined : `collectible:${id}`),
      onFartlekHover: (id) => hoverPlannerItem(id === undefined ? undefined : `flowline:${id}`),
      onFartlekSelect: (id) => {
        if (showsFlowlineEnhancements(planner) && planner.flowlineEnhancements.some(({ flowline }) => flowline.id === id)) void toggleFlowlineEnhancement(id, !planner.selectedEnhancementIds.includes(id));
      }
    });
  } catch (error) {
    mapContainer.innerHTML = `<p class="world-load-error" role="alert">Unable to load the map: ${escapeHtml(error.message)}</p>`;
    return;
  }

  mountPoint.querySelector("[data-world-locate]").addEventListener("click", () => locate({
    fly: true,
    onDenied: (message) => setStatus(`${message} Pan and zoom to explore.`)
  }));

  renderAll();
  await loadViewport(worldMap.getBounds());
};
