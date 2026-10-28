import { getAppLocale } from "../app-locales.js";
import { escapeHtml } from "./collected-list.js";
import { markerLabel } from "./world/world-markers.js";
import { collectibleCategory, collectiblesToFeatureCollection } from "./world/collectible-features.js";
import { CollectibleSwatch } from "./world/collectible-swatch.js";
import { fartleksToFeatureCollection } from "./world/fartlek-features.js";
import { boundsToParameter, createWorldMap, homeScaleZoom } from "./world/world-map.js";
import { readHomeLocation, saveHomeLocation } from "./world/home-location.js";
import { boundsContain, expandBounds, isServedByLoadedArea, scaleBounds } from "./shared/map/staza-map-utils.js";
import { QuestList } from "./world/quest-list.js";
import { CollectibleDetail } from "./world/collectible-detail.js";
import { FartlekDetail } from "./world/fartlek-detail.js";
import {
  activeProposal,
  buildGenerateRequest,
  createExplorationState,
  ExplorationPanel,
  findCatalogTarget,
  routeTargetIds,
  traversedFlowlines
} from "./world/exploration-panel.js";

export const worldFilters = ["all", "found", "unfound", "fartleks", "viewpoint", "peak", "castle", "waterfall", "place", "mountain_pass"];

export const advancedWorldFilters = ["undiscovered-only", "peaks-only", "high-flow", "long-endurance"];

const HIGH_FLOW_SCORE = 70;
const LONG_FLOWLINE_METERS = 5000;

/** Advanced filters granted by Skill Atlas nodes; each narrows collectibles and Flowlines. */
const grantedFilterRules = {
  "undiscovered-only": { collectible: (item) => !item.found, fartlek: (item) => !item.completed },
  "peaks-only": { collectible: (item) => collectibleCategory(item) === "peak", fartlek: () => false },
  "high-flow": { collectible: () => false, fartlek: (item) => (item.flowScore ?? 0) >= HIGH_FLOW_SCORE },
  "long-endurance": { collectible: () => false, fartlek: (item) => item.lengthMeters >= LONG_FLOWLINE_METERS }
};

const filterLabels = {
  all: "All",
  found: "Found",
  unfound: "Unfound",
  fartleks: "Flowlines",
  viewpoint: "Viewpoint",
  peak: "Peak",
  castle: "Castle",
  waterfall: "Waterfall",
  place: "Place",
  mountain_pass: "Mountain pass",
  "undiscovered-only": "Undiscovered only",
  "peaks-only": "Peaks only",
  "high-flow": "High flow",
  "long-endurance": "Long Flowlines"
};

const formatNumber = (value) => new Intl.NumberFormat(getAppLocale()).format(value);

export const visibleWorldCollectibles = (collectibles) =>
  collectibles.filter((collectible) => collectible.visibility !== "hidden");

export const availableWorldFilters = (collectibles, fartleks = [], grantedFilters = []) => {
  const visibleCollectibles = visibleWorldCollectibles(collectibles);
  const filters = new Set(["all"]);

  if (visibleCollectibles.some((collectible) => collectible.found)) filters.add("found");
  if (visibleCollectibles.some((collectible) => !collectible.found)) filters.add("unfound");
  if (fartleks.length) filters.add("fartleks");

  for (const category of ["viewpoint", "peak", "castle", "waterfall", "place", "mountain_pass"]) {
    if (visibleCollectibles.some((collectible) => collectibleCategory(collectible) === category)) {
      filters.add(category);
    }
  }

  for (const filter of grantedFilters) {
    if (filter in grantedFilterRules) filters.add(filter);
  }

  return filters;
};

export const filteredWorldCollectibles = (collectibles, selectedFilters) =>
  visibleWorldCollectibles(collectibles).filter((collectible) =>
    selectedFilters.length === 0 || selectedFilters.some((filter) => {
      if (filter === "fartleks") return false;
      if (filter in grantedFilterRules) return grantedFilterRules[filter].collectible(collectible);
      if (filter === "found") return collectible.found;
      if (filter === "unfound") return !collectible.found;
      return collectibleCategory(collectible) === filter;
    }));

/** Fartlek completion is independent of collectible discovery filters. */
export const filteredWorldFartleks = (fartleks, selectedFilters) =>
  selectedFilters.length === 0 || selectedFilters.includes("fartleks")
    ? fartleks
    : fartleks.filter((fartlek) => selectedFilters.some((filter) => grantedFilterRules[filter]?.fartlek(fartlek)));

/** Collectibles drawn on the map, respecting the active discovery filters. */
export const mappedWorldCollectibles = (collectibles, selectedFilters, questCollectibles = []) => {
  const mapped = [...filteredWorldCollectibles(collectibles, selectedFilters)];
  for (const collectible of questCollectibles) {
    if (!mapped.some((item) => item.id === collectible.id)) mapped.push(collectible);
  }
  return mapped;
};

export const mappedWorldFartleks = (fartleks, selectedFilters, questFartleks = []) => {
  const mapped = [...filteredWorldFartleks(fartleks, selectedFilters)];
  for (const fartlek of questFartleks) {
    if (!mapped.some((item) => item.id === fartlek.id)) mapped.push(fartlek);
  }
  return mapped;
};

const filterSwatch = (filter) => {
  if (filter === "all" || filter in grantedFilterRules) return "";
  if (filter === "fartleks") return '<b class="fartlek-swatch" aria-hidden="true"></b>';
  if (filter === "found" || filter === "unfound") return CollectibleSwatch({ visited: filter === "found" });
  return CollectibleSwatch({ category: filter });
};

const isFilterSelected = (filter, selectedFilters) =>
  filter === "all" ? selectedFilters.length === 0 : selectedFilters.includes(filter);

export const WorldFilterControls = (selectedFilters, collectibles = [], fartleks = [], grantedFilters = []) => {
  const availableFilters = availableWorldFilters(collectibles, fartleks, grantedFilters);
  return `
  <div class="world-filter-controls" data-world-filter-controls role="group" aria-label="World collectibles and Flowlines">
    ${[...worldFilters, ...advancedWorldFilters].map((filter) => {
      const selected = isFilterSelected(filter, selectedFilters);
      return `
        <button class="${selected ? "is-active" : ""}" type="button"${availableFilters.has(filter) ? "" : " hidden"}
          aria-pressed="${selected}" data-world-filter="${filter}">
          ${filterSwatch(filter)}<span>${filterLabels[filter]}</span>
        </button>
      `;
    }).join("")}
  </div>
`;
};

export const WorldStats = (stats, truncated) => `
  <p class="world-stats">
    <span>${formatNumber(stats.discoveredCount)} visited here</span>
    <i aria-hidden="true">\u00b7</i>
    <span>${formatNumber(stats.remainingCount)} remaining</span>
    ${truncated ? '<i aria-hidden="true">\u00b7</i><span class="world-stats-truncated">Zoom in to see everything here</span>' : ""}
  </p>
`;

export const WorldPage = ({ lifetime, selectedFilters }) => `
  <section class="world-page" aria-labelledby="world-title">
    <header class="world-header">
      <div>
        <h1 id="world-title">World</h1>
        <p>Discover what is worth exploring</p>
      </div>
      <div class="world-discovered">
        <span>Discovered</span>
        <strong>${formatNumber(lifetime.discoveredCount)} <i>/ ${formatNumber(lifetime.totalCollectibles)}</i></strong>
      </div>
    </header>
    ${WorldFilterControls(selectedFilters)}
    <div class="world-map-shell">
      <div class="world-map staza-map" data-world-map></div>
      <ul class="world-collectible-list" aria-label="Collectibles on the map" data-world-collectible-list></ul>
      <a class="world-osm-attribution" href="https://www.openstreetmap.org/copyright"
        target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>
      <div class="world-map-actions">
        <button class="world-locate" type="button" data-world-locate>LOCATE ME</button>
      </div>
      <button class="world-explore" type="button" data-world-explore>EXPLORE THIS AREA</button>
      <p class="world-map-status" data-world-status role="status" hidden></p>
      <div class="world-detail-host" data-world-detail hidden></div>
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

const emptyStats = { totalCollectibles: 0, discoveredCount: 0, remainingCount: 0 };

const expiredCodes = new Set(["exploration_expired", "proposal_expired"]);

export const explorationErrorMessage = (error) => {
  if (expiredCodes.has(error.code)) return "These routes expired. Generate routes again.";
  return error.message;
};

export const mountWorldPage = async (mountPoint) => {
  mountPoint.innerHTML = '<section class="world-page"><p class="world-loading" role="status">Loading World...</p></section>';

  let basemap;
  let lifetime = emptyStats;
  let questInstances = [];
  let grantedFilters = [];
  try {
    const [loadedBasemap, globalSnapshot, activeQuests] = await Promise.all([
      fetch("/api/world/basemap").then(responseJson),
      fetch("/api/world").then(responseJson),
      fetch("/api/quest-instances").then(responseJson)
    ]);
    basemap = loadedBasemap;
    lifetime = globalSnapshot.stats;
    questInstances = activeQuests.instances;
    // Filters are an enhancement; the World stays usable if capabilities cannot load.
    grantedFilters = await fetch("/api/player/capabilities").then(responseJson).then((body) => body.worldFilters ?? []).catch(() => []);
  } catch (error) {
    mountPoint.innerHTML = `<section class="world-page"><p class="world-load-error" role="alert">Unable to load World: ${escapeHtml(error.message)}</p></section>`;
    return;
  }

  let selectedFilters = [];
  let collectibles = [];
  let pendingQuestId;
  let stats = emptyStats;
  let truncated = false;
  let fartleks = [];
  let availableFilters = availableWorldFilters(collectibles, fartleks, grantedFilters);
  let selection;
  let selectedQuestKey;
  let selectedQuestTargets = { collectibles: [], flowlines: [] };
  let questSelectionToken = 0;
  let requestToken = 0;
  /** Collectible cache: the wide area last loaded, so panning inside it never reloads icons. */
  let loadedArea;
  let worldMap;
  /** Active "Explore this Area" session; undefined in the NORMAL map state. */
  let exploration;
  let explorationToken = 0;
  const plannedRoutes = new Map();

  mountPoint.innerHTML = WorldPage({ lifetime, selectedFilters });
  const mapContainer = mountPoint.querySelector("[data-world-map]");
  const statusHost = mountPoint.querySelector("[data-world-status]");
  const statsHost = mountPoint.querySelector("[data-world-stats]");
  const questHost = mountPoint.querySelector("[data-world-quests]");
  const detailHost = mountPoint.querySelector("[data-world-detail]");
  const collectibleListHost = mountPoint.querySelector("[data-world-collectible-list]");
  const exploreButton = mountPoint.querySelector("[data-world-explore]");
  const setStatus = (message) => {
    statusHost.hidden = !message;
    statusHost.textContent = message ?? "";
  };

  const collectibleById = (id) => collectibles.find((collectible) => collectible.id === id);
  const fartlekById = (id) => fartleks.find((fartlek) => fartlek.id === id);

  /**
   * Exploration markers by phase. While configuring, World markers stay as dimmed context and no
   * exploration targets are revealed. Once a route is selected, the frozen area's targets are shown
   * dimmed and only the selected route's contents are highlighted; hovering any marker highlights it,
   * so eligible targets stay visible and pickable in add mode.
   */
  const renderExplorationTargets = () => {
    if (exploration.phase === "configure" || exploration.phase === "generating") {
      const mapped = mappedWorldCollectibles(collectibles, selectedFilters, []);
      const mappedFartleks = mappedWorldFartleks(fartleks, selectedFilters, []);
      worldMap?.setCollectibles(collectiblesToFeatureCollection(mapped, { questCollectibleIds: [] }));
      worldMap?.setFartleks(fartleksToFeatureCollection(mappedFartleks, { questTargetIds: [] }));
      renderCollectibleList(mapped, undefined, mappedFartleks, undefined);
      return;
    }
    const { catalog } = exploration;
    const mapped = visibleWorldCollectibles(catalog.collectibles);
    const highlighted = exploration.adding
      ? catalog.collectibles.map((item) => item.id)
      : exploration.pendingTargetIds ?? routeTargetIds(activeProposal(exploration));
    const alongIds = new Set(traversedFlowlines(activeProposal(exploration)).map((flowline) => flowline.id));
    const alongFlowlines = catalog.flowlines.filter((flowline) => alongIds.has(flowline.id));
    worldMap?.setCollectibles(collectiblesToFeatureCollection(mapped, {
      selectedId: exploration.hoveredTargetId,
      questCollectibleIds: highlighted
    }));
    worldMap?.setFartleks(fartleksToFeatureCollection(alongFlowlines, {
      selectedId: exploration.hoveredTargetId,
      questTargetIds: [...alongIds]
    }));
    renderCollectibleList(mapped, undefined, alongFlowlines, undefined);
  };

  const renderCollectibles = () => {
    if (exploration) {
      renderExplorationTargets();
      return;
    }
    const selectedCollectibleId = selection?.kind === "collectible" ? selection.id : undefined;
    const questCollectibleIds = selectedQuestKey
      ? selectedQuestTargets.collectibles.map((collectible) => collectible.id)
      : undefined;
    const mapped = mappedWorldCollectibles(collectibles, selectedFilters, selectedQuestTargets.collectibles);
    worldMap?.setCollectibles(collectiblesToFeatureCollection(mapped, {
      selectedId: selectedCollectibleId,
      questCollectibleIds
    }));

    const selectedFartlekId = selection?.kind === "fartlek" ? selection.id : undefined;
    const questFlowlineIds = selectedQuestKey
      ? selectedQuestTargets.flowlines.map((flowline) => flowline.id)
      : undefined;
    const mappedFartleks = mappedWorldFartleks(fartleks, selectedFilters, selectedQuestTargets.flowlines);
    worldMap?.setFartleks(fartleksToFeatureCollection(mappedFartleks, {
      selectedId: selectedFartlekId,
      questTargetIds: questFlowlineIds
    }));

    renderCollectibleList(mapped, selectedCollectibleId, mappedFartleks, selectedFartlekId);
  };

  const renderCollectibleList = (mapped, selectedCollectibleId, mappedFartleks, selectedFartlekId) => {
    const collectibleItems = mapped.map((collectible) => `
      <li>
        <button type="button" data-world-marker="${escapeHtml(collectible.id)}"
          aria-pressed="${collectible.id === selectedCollectibleId}" data-user-content>${escapeHtml(markerLabel(collectible))}</button>
      </li>
    `).join("");
    const fartlekItems = mappedFartleks.map((fartlek) => `
      <li>
        <button type="button" class="world-fartlek-marker" data-world-fartlek="${escapeHtml(fartlek.id)}"
          aria-pressed="${fartlek.id === selectedFartlekId}" data-user-content>${escapeHtml(fartlek.name)}, ${fartlek.completed ? "completed" : "not completed"}</button>
      </li>
    `).join("");
    collectibleListHost.innerHTML = collectibleItems + fartlekItems;
    collectibleListHost.querySelectorAll("[data-world-marker]").forEach((button) => {
      button.addEventListener("click", () => selectCollectible(button.dataset.worldMarker));
    });
    collectibleListHost.querySelectorAll("[data-world-fartlek]").forEach((button) => {
      button.addEventListener("click", () => selectFartlek(button.dataset.worldFartlek));
    });
  };

  const hideDetail = () => {
    detailHost.hidden = true;
    detailHost.innerHTML = "";
    worldMap?.setDetailPanelOpen(false);
  };

  const renderDetail = () => {
    if (exploreButton) exploreButton.hidden = Boolean(exploration);
    if (exploration) {
      detailHost.hidden = false;
      worldMap?.setDetailPanelOpen(true);
      detailHost.innerHTML = ExplorationPanel(exploration);
      bindExploration();
      return;
    }
    if (!selection) {
      hideDetail();
      return;
    }
    detailHost.hidden = false;
    worldMap?.setDetailPanelOpen(true);
    if (selection.kind === "fartlek") {
      const fartlek = fartlekById(selection.id);
      if (!fartlek) {
        hideDetail();
        return;
      }
      detailHost.innerHTML = FartlekDetail(fartlek);
    } else {
      const collectible = collectibleById(selection.id);
      if (!collectible) {
        hideDetail();
        return;
      }
      detailHost.innerHTML = CollectibleDetail(collectible, []);
    }
    detailHost.querySelector("[data-world-close]")?.addEventListener("click", clearSelection);
    detailHost.querySelectorAll("[data-world-marker]").forEach((button) => {
      button.addEventListener("click", () => selectCollectible(button.dataset.worldMarker));
    });
  };

  const renderSidePanels = () => {
    statsHost.innerHTML = WorldStats(stats, truncated);
    questHost.innerHTML = QuestList(questInstances, pendingQuestId, selectedQuestKey, plannedRoutes);
    questHost.querySelectorAll("[data-quest-cancel]").forEach((button) => {
      button.addEventListener("click", () => void cancelQuest(button.dataset.questCancel));
    });
    questHost.querySelectorAll("[data-quest-select]").forEach((button) => {
      button.addEventListener("click", () => void selectQuest(button.dataset.questSelect));
    });
    questHost.querySelectorAll("[data-quest-card]").forEach((card) => {
      card.addEventListener("click", (event) => {
        if (event.target.closest("button")) return;
        void selectQuest(card.dataset.questCard);
      });
    });
  };

  const renderFilters = () => {
    mountPoint.querySelectorAll("[data-world-filter]").forEach((button) => {
      button.hidden = !availableFilters.has(button.dataset.worldFilter);
      const selected = isFilterSelected(button.dataset.worldFilter, selectedFilters);
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  };

  function clearSelection() {
    selection = undefined;
    renderCollectibles();
    renderSidePanels();
    renderDetail();
  }

  function selectCollectible(id) {
    if (exploration) {
      addExplorationTarget(id);
      return;
    }
    selection = selection?.kind === "collectible" && selection.id === id
      ? undefined
      : { kind: "collectible", id };
    renderCollectibles();
    renderDetail();
  }

  function selectFartlek(id) {
    if (exploration) {
      addExplorationTarget(id);
      return;
    }
    selection = selection?.kind === "fartlek" && selection.id === id
      ? undefined
      : { kind: "fartlek", id };
    renderCollectibles();
    renderDetail();
  }

  async function selectQuest(key) {
    if (exploration) return;
    const token = ++questSelectionToken;
    if (selectedQuestKey === key) {
      selectedQuestKey = undefined;
      selectedQuestTargets = { collectibles: [], flowlines: [] };
      syncRouteLayers();
      renderCollectibles();
      renderSidePanels();
      return;
    }

    const instance = key.startsWith("instance:")
      ? questInstances.find((item) => item.id === key.slice("instance:".length))
      : undefined;
    if (!instance) return;

    const objectives = instance.objectives.map((state) => state.objective);
    const collectibleIds = [...new Set(objectives
      .filter((objective) => objective.type !== "flowline_rule")
      .flatMap((objective) => objective.targets.map((target) => target.id)))];
    const flowlineIds = [...new Set(objectives
      .filter((objective) => objective.type === "flowline_rule")
      .flatMap((objective) => objective.targets.map((target) => target.id)))];
    const query = new URLSearchParams();
    collectibleIds.forEach((id) => query.append("collectibleId", id));
    flowlineIds.forEach((id) => query.append("flowlineId", id));

    selectedQuestKey = key;
    selectedQuestTargets = { collectibles: [], flowlines: [] };
    selection = undefined;
    syncRouteLayers();
    renderCollectibles();
    renderSidePanels();
    renderDetail();
    try {
      const [targets] = await Promise.all([
        fetch(`/api/world/quest-targets?${query.toString()}`).then(responseJson),
        !plannedRoutes.has(instance.id)
          ? loadPlannedRoute(instance.id).then((route) => plannedRoutes.set(instance.id, route))
          : undefined
      ]);
      if (token !== questSelectionToken) return;
      selectedQuestTargets = {
        collectibles: targets.collectibles,
        flowlines: targets.flowlines
      };
      renderCollectibles();
      renderSidePanels();
      syncRouteLayers();
      const plannedRoute = plannedRoutes.get(instance.id);
      const points = [
        ...targets.collectibles.map(({ latitude, longitude }) => ({ latitude, longitude })),
        ...targets.flowlines.flatMap((flowline) => geometryPoints(flowline.geometry)),
        ...(plannedRoute ? geometryPoints(plannedRoute.geometry) : [])
      ];
      worldMap.fitTo(points);
    } catch (error) {
      if (token !== questSelectionToken) return;
      selectedQuestKey = undefined;
      selectedQuestTargets = { collectibles: [], flowlines: [] };
      renderCollectibles();
      renderSidePanels();
      setStatus(error.message);
    }
  }

  /**
   * Routes shown on the map. While exploring, only the selected or hovered proposal is visible;
   * otherwise the selected quest's PlannedRoute.
   */
  function syncRouteLayers() {
    if (!worldMap) return;
    worldMap.setPickHandler(exploration?.picking ? pickExplorationPoint : undefined);
    if (exploration) {
      const shownId = exploration.previewProposalId ?? exploration.selectedProposalId;
      const shown = activeProposal(exploration, shownId);
      worldMap.setRouteEndpoints({
        start: exploration.start,
        end: exploration.routeType === "point_to_point" ? exploration.end : undefined
      });
      worldMap.setRoute(shown ? { geometry: shown.geometry } : undefined);
      worldMap.setAlternateRoutes([]);
      return;
    }
    worldMap.setAlternateRoutes([]);
    const instanceId = selectedQuestKey?.startsWith("instance:") ? selectedQuestKey.slice("instance:".length) : undefined;
    const plannedRoute = instanceId ? plannedRoutes.get(instanceId) : undefined;
    worldMap.setRouteEndpoints(plannedRoute ? {
      start: plannedRoute.start,
      end: plannedRoute.routeType === "point_to_point" ? plannedRoute.end : undefined
    } : {});
    worldMap.setRoute(plannedRoute ? { geometry: plannedRoute.geometry } : undefined);
  }

  const renderExploration = () => {
    syncRouteLayers();
    renderCollectibles();
    renderDetail();
  };

  /** NORMAL → CONFIGURE: freezes the visible area for the whole exploration. */
  function openExploration() {
    if (!worldMap || exploration) return;
    const view = worldMap.getView();
    explorationToken += 1;
    selectedQuestKey = undefined;
    selectedQuestTargets = { collectibles: [], flowlines: [] };
    selection = undefined;
    exploration = createExplorationState({
      bbox: boundsToParameter(worldMap.getBounds()),
      center: view.center,
      zoom: view.zoom
    });
    setStatus(undefined);
    renderSidePanels();
    renderExploration();
  }

  /** Any phase → NORMAL. Server-side proposals simply expire; nothing was persisted. */
  function closeExploration() {
    explorationToken += 1;
    exploration = undefined;
    renderExploration();
  }

  /** Back to CONFIGURE with the ride kept; generated proposals and customizations are discarded. */
  function returnToConfigure(error) {
    explorationToken += 1;
    Object.assign(exploration, {
      phase: "configure",
      status: "idle",
      explorationId: undefined,
      proposals: [],
      customizedById: {},
      selectedProposalId: undefined,
      previewProposalId: undefined,
      hoveredTargetId: undefined,
      catalog: { collectibles: [], flowlines: [] },
      truncated: false,
      adding: false,
      pendingTargetIds: undefined,
      error
    });
  }

  function pickExplorationPoint(point) {
    if (!exploration?.picking || exploration.phase !== "configure") return;
    if (exploration.picking === "end") exploration.end = point;
    else exploration.start = point;
    exploration.picking = exploration.routeType === "point_to_point" && !exploration.end ? "end" : undefined;
    exploration.error = undefined;
    renderExploration();
  }

  function locateExplorationStart() {
    const geolocation = globalThis.navigator?.geolocation;
    if (!geolocation) {
      exploration.error = "Location is not available in this browser. Select your start on the map.";
      renderDetail();
      return;
    }
    geolocation.getCurrentPosition(
      (position) => {
        if (!exploration || exploration.phase !== "configure") return;
        exploration.picking = "start";
        pickExplorationPoint({ lat: position.coords.latitude, lon: position.coords.longitude });
      },
      () => {
        if (!exploration) return;
        exploration.error = "Location permission was denied. Select your start on the map.";
        renderDetail();
      }
    );
  }

  /** CONFIGURE → GENERATING → CUSTOMIZE: the planner picks targets; the best route is auto-selected. */
  async function generateRoutes() {
    if (!exploration || exploration.phase !== "configure") return;
    const { body, error } = buildGenerateRequest(exploration);
    if (error) {
      exploration.error = error;
      renderDetail();
      return;
    }
    const token = ++explorationToken;
    exploration.phase = "generating";
    exploration.picking = undefined;
    exploration.error = undefined;
    renderExploration();
    try {
      const result = await jsonRequest("POST", "/api/explorations/generate", body);
      if (token !== explorationToken || !exploration) return;
      const preferred = result.proposals.find((proposal) => proposal.recommended) ?? result.proposals[0];
      Object.assign(exploration, {
        explorationId: result.explorationId,
        proposals: result.proposals,
        customizedById: {},
        catalog: result.catalog,
        truncated: Boolean(result.truncated),
        limits: result.limits ?? exploration.limits,
        selectedProposalId: preferred?.id,
        phase: preferred ? "customize" : "proposals"
      });
      worldMap.fitTo(result.proposals.flatMap((proposal) => geometryPoints(proposal.geometry)));
    } catch (generateError) {
      if (token !== explorationToken || !exploration) return;
      exploration.phase = "configure";
      exploration.error = explorationErrorMessage(generateError);
    }
    renderExploration();
  }

  /** GENERATING → CONFIGURE without waiting; a late response is ignored. */
  function stopGenerating() {
    if (exploration?.phase !== "generating") return;
    returnToConfigure(undefined);
    renderExploration();
  }

  /** PROPOSALS/CUSTOMIZE → CUSTOMIZE for another proposal; its own edits are kept. */
  function selectProposal(id) {
    if (!exploration || exploration.status !== "idle") return;
    if (exploration.phase !== "proposals" && exploration.phase !== "customize") return;
    const proposal = activeProposal(exploration, id);
    if (!proposal) return;
    Object.assign(exploration, { selectedProposalId: id, previewProposalId: undefined, hoveredTargetId: undefined, adding: false, error: undefined, phase: "customize" });
    worldMap.fitTo(geometryPoints(proposal.geometry));
    renderExploration();
  }

  /** Temporarily draws a hovered proposal strong without changing the selection. */
  function previewProposal(id) {
    if (!exploration || (exploration.phase !== "proposals" && exploration.phase !== "customize")) return;
    if (exploration.previewProposalId === id) return;
    exploration.previewProposalId = id;
    syncRouteLayers();
  }

  /** CUSTOMIZE: re-plans only the selected route for an edited target set. */
  async function rerouteSelected(targetIds) {
    const current = activeProposal(exploration);
    if (!current || exploration.phase !== "customize" || exploration.status !== "idle") return;
    const originalId = exploration.selectedProposalId;
    const token = ++explorationToken;
    Object.assign(exploration, {
      status: "rerouting",
      pendingTargetIds: targetIds,
      adding: false,
      previewProposalId: undefined,
      hoveredTargetId: undefined,
      error: undefined
    });
    renderExploration();
    try {
      const { proposal } = await jsonRequest(
        "POST",
        `/api/explorations/${encodeURIComponent(exploration.explorationId)}/reroute`,
        { proposalId: current.id, targetIds }
      );
      if (token !== explorationToken || !exploration) return;
      exploration.customizedById = { ...exploration.customizedById, [originalId]: proposal };
      exploration.status = "idle";
      exploration.pendingTargetIds = undefined;
    } catch (rerouteError) {
      if (token !== explorationToken || !exploration) return;
      exploration.status = "idle";
      exploration.pendingTargetIds = undefined;
      if (expiredCodes.has(rerouteError.code)) returnToConfigure(explorationErrorMessage(rerouteError));
      else exploration.error = explorationErrorMessage(rerouteError);
    }
    renderExploration();
  }

  function removeExplorationTarget(id) {
    const contents = routeTargetIds(activeProposal(exploration));
    if (contents.length <= 1 || !contents.includes(id)) return;
    void rerouteSelected(contents.filter((targetId) => targetId !== id));
  }

  /** Briefly emphasize the matching map marker while a route target row is hovered. */
  function previewExplorationTarget(id) {
    if (!exploration || exploration.phase !== "customize") return;
    if (exploration.hoveredTargetId === id) return;
    exploration.hoveredTargetId = id;
    renderCollectibles();
  }

  /** In add mode, a map or list selection of an eligible target of the frozen area adds it. */
  function addExplorationTarget(id) {
    if (!exploration?.adding || exploration.status !== "idle" || exploration.phase !== "customize") return;
    if (!findCatalogTarget(exploration.catalog, id)) return;
    const contents = routeTargetIds(activeProposal(exploration));
    if (contents.includes(id)) return;
    if (contents.length >= exploration.limits.maxRouteTargets) {
      exploration.error = `A route can include at most ${exploration.limits.maxRouteTargets} targets.`;
      renderDetail();
      return;
    }
    void rerouteSelected([...contents, id]);
  }

  /** Restores the originally generated version of the selected route (no network). */
  function resetSelectedRoute() {
    if (!exploration || exploration.status !== "idle") return;
    const { [exploration.selectedProposalId]: _discarded, ...rest } = exploration.customizedById;
    exploration.customizedById = rest;
    exploration.adding = false;
    exploration.error = undefined;
    const proposal = activeProposal(exploration);
    if (proposal) worldMap.fitTo(geometryPoints(proposal.geometry));
    renderExploration();
  }

  /** CUSTOMIZE → CONFIRMING → NORMAL with the new exploration selected on the map. */
  async function confirmExploration() {
    const proposal = activeProposal(exploration);
    if (!proposal || exploration.phase !== "customize" || exploration.status !== "idle") return;
    const token = ++explorationToken;
    exploration.phase = "confirming";
    exploration.adding = false;
    exploration.error = undefined;
    renderExploration();
    try {
      const { instance, plannedRoute } = await jsonRequest("POST", "/api/explorations/confirm", { proposalId: proposal.id });
      if (token !== explorationToken || !exploration) return;
      plannedRoutes.set(instance.id, plannedRoute ?? null);
      questInstances = (await fetch("/api/quest-instances").then(responseJson)).instances;
      exploration = undefined;
      renderExploration();
      await selectQuest(`instance:${instance.id}`);
    } catch (confirmError) {
      if (token !== explorationToken || !exploration) return;
      exploration.phase = "customize";
      if (expiredCodes.has(confirmError.code)) returnToConfigure(explorationErrorMessage(confirmError));
      else exploration.error = explorationErrorMessage(confirmError);
      renderExploration();
    }
  }

  function bindExploration() {
    const on = (selector, event, handler) => detailHost.querySelectorAll(selector).forEach((element) => {
      element.addEventListener(event, (domEvent) => handler(element, domEvent));
    });
    const updateRide = (change) => {
      if (exploration.phase !== "configure") return;
      change();
      exploration.error = undefined;
      renderExploration();
    };
    on("[data-exploration-cancel]", "click", () => closeExploration());
    on("[data-exploration-pick]", "click", (button) => updateRide(() => {
      exploration.picking = exploration.picking === button.dataset.explorationPick ? undefined : button.dataset.explorationPick;
    }));
    on("[data-exploration-locate]", "click", () => locateExplorationStart());
    on("[data-exploration-route-type]", "click", (button) => updateRide(() => {
      exploration.routeType = button.dataset.explorationRouteType;
      exploration.picking = exploration.routeType === "point_to_point" && !exploration.end ? "end" : undefined;
    }));
    on("[data-exploration-constraint]", "click", (button) => updateRide(() => {
      exploration.constraintType = button.dataset.explorationConstraint;
    }));
    on("[data-exploration-preset]", "click", (button) => updateRide(() => {
      if (exploration.constraintType === "distance") exploration.distanceKm = Number(button.dataset.explorationPreset);
      else exploration.durationMin = Number(button.dataset.explorationPreset);
    }));
    on("[data-exploration-custom]", "change", (input) => updateRide(() => {
      if (exploration.constraintType === "distance") exploration.distanceKm = Number(input.value);
      else exploration.durationMin = Number(input.value);
    }));
    on("[data-exploration-form]", "submit", (_form, event) => {
      event?.preventDefault?.();
      void generateRoutes();
    });
    on("[data-exploration-stop]", "click", () => stopGenerating());
    on("[data-exploration-edit-ride]", "click", () => {
      if (exploration.status !== "idle") return;
      returnToConfigure(undefined);
      renderExploration();
    });
    on("[data-exploration-proposal]", "click", (button) => selectProposal(button.dataset.explorationProposal));
    on("[data-exploration-proposal]", "mouseenter", (button) => previewProposal(button.dataset.explorationProposal));
    on("[data-exploration-proposal]", "mouseleave", () => previewProposal(undefined));
    on("[data-exploration-target]", "mouseenter", (item) => previewExplorationTarget(item.dataset.explorationTarget));
    on("[data-exploration-target]", "mouseleave", () => previewExplorationTarget(undefined));
    on("[data-exploration-remove]", "click", (button) => removeExplorationTarget(button.dataset.explorationRemove));
    on("[data-exploration-add]", "click", () => {
      if (exploration.status !== "idle" || exploration.phase !== "customize") return;
      exploration.adding = !exploration.adding;
      exploration.error = undefined;
      renderExploration();
    });
    on("[data-exploration-reset]", "click", () => resetSelectedRoute());
    on("[data-exploration-confirm]", "click", () => void confirmExploration());
  }

  async function cancelQuest(instanceId) {
    if (pendingQuestId || !globalThis.confirm(
      "Cancel this exploration and delete its progress? This cannot be undone."
    )) return;
    pendingQuestId = instanceId;
    renderSidePanels();
    try {
      await fetch(`/api/quest-instances/${encodeURIComponent(instanceId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" }
      }).then(responseJson);
      questInstances = (await fetch("/api/quest-instances").then(responseJson)).instances;
      plannedRoutes.delete(instanceId);
      if (selectedQuestKey === `instance:${instanceId}`) {
        selectedQuestKey = undefined;
        selectedQuestTargets = { collectibles: [], flowlines: [] };
        syncRouteLayers();
        renderCollectibles();
      }
    } catch (error) {
      setStatus(error.message);
    } finally {
      pendingQuestId = undefined;
      renderSidePanels();
    }
  }

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
      stats = snapshot.stats;
      truncated = loadedArea.truncated || snapshot.fartlekTruncated === true;
      fartleks = snapshot.fartleks ?? [];
      availableFilters = availableWorldFilters(collectibles, fartleks, grantedFilters);
      selectedFilters = selectedFilters.filter((filter) => availableFilters.has(filter));
      setStatus(collectibles.length === 0 && fartleks.length === 0 ? "Nothing curated here yet." : undefined);
      if (selection?.kind === "collectible" && !collectibleById(selection.id)) selection = undefined;
      if (selection?.kind === "fartlek" && !fartlekById(selection.id)) selection = undefined;
      renderFilters();
      renderCollectibles();
      renderSidePanels();
      if (!exploration) renderDetail();
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

  mountPoint.querySelectorAll("[data-world-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const filter = button.dataset.worldFilter;
      selectedFilters = filter === "all" ? [] : selectedFilters.includes(filter)
        ? selectedFilters.filter((selected) => selected !== filter)
        : [...selectedFilters, filter];
      if (selection?.kind === "collectible"
        && !filteredWorldCollectibles(collectibles, selectedFilters).some((item) => item.id === selection.id)) {
        selection = undefined;
      }
      if (selection?.kind === "fartlek"
        && !filteredWorldFartleks(fartleks, selectedFilters).some((item) => item.id === selection.id)) {
        selection = undefined;
      }
      renderFilters();
      renderCollectibles();
      if (!exploration) renderDetail();
    });
  });

  renderSidePanels();

  let homePosition;
  try {
    homePosition = readHomeLocation();
  } catch (error) {
    setStatus(`Unable to load saved home location: ${error.message}`);
  }

  try {
    worldMap = await createWorldMap(mapContainer, {
      styleUrl: basemap.styleUrl,
      attribution: basemap.attribution,
      homePosition,
      onViewportChange: scheduleViewportLoad,
      onCollectibleSelect: (id) => selectCollectible(id),
      onCollectibleHover: (id) => previewExplorationTarget(id),
      onFartlekSelect: (id) => selectFartlek(id),
      onAlternateRouteSelect: (id) => selectProposal(id)
    });
  } catch (error) {
    mapContainer.innerHTML = `<p class="world-load-error" role="alert">Unable to load the map: ${escapeHtml(error.message)}</p>`;
    return;
  }

  exploreButton?.addEventListener("click", () => openExploration());

  mountPoint.querySelector("[data-world-locate]").addEventListener("click", () => {
    if (!navigator.geolocation) {
      setStatus("Location is not available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        try {
          saveHomeLocation(location);
        } catch (error) {
          setStatus(`Unable to save home location: ${error.message}`);
        }
        worldMap.setHomePosition(location);
        worldMap.flyTo(location.longitude, location.latitude, homeScaleZoom(location.latitude));
      },
      () => setStatus("Location permission was denied. Pan and zoom to explore.")
    );
  });

  await loadViewport(worldMap.getBounds());
};
