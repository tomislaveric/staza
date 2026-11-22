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
import { DiscoveriesPanel, exploreCta, ExploreResultCard, revealSequence } from "./world/explore-reveal.js";
import {
  buildPlanRequest,
  buildSuggestRequest,
  collectibleStop,
  createPlannerState,
  DEFAULT_ROUTE_INTENT,
  flowlineStop,
  moveStop,
  orderStops,
  RoutePlannerPanel,
  toggleStop,
  waypointStop
} from "./world/route-planner.js";

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

export const WorldFilterControls = (selectedFilters, collectibles = [], fartleks = [], grantedFilters = [], lockedFilters = []) => {
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
    ${lockedFilters.filter((filter) => filter.id in grantedFilterRules && !grantedFilters.includes(filter.id)).map((filter) => `
      <button class="world-filter-locked" type="button" data-world-filter-unlock="${escapeHtml(filter.nodeId)}">
        <span>${filterLabels[filter.id]}</span><small>Unlock ${escapeHtml(filter.nodeName)} in the Skill Atlas</small>
      </button>`).join("")}
  </div>
`;
};

/** Only a hint when the viewport is capped; per-viewport counts are not shown. */
export const WorldStats = (truncated) => truncated
  ? '<p class="world-stats"><span class="world-stats-truncated">Zoom in to see everything here</span></p>'
  : "";

/**
 * Primary Explore CTA plus a small "Plan route" entry; hidden Flowlines are never drawn.
 * The CTA stays disabled until the map is ready (`ready: false`) or while exploring.
 */
export const WorldExploreControls = ({ busy = false, ready = true, stopCount = 0 } = {}) => {
  const cta = exploreCta();
  return `
    <button class="world-explore" type="button" data-world-explore="${cta.action}"${busy || !ready ? " disabled" : ""}>${escapeHtml(cta.label)}</button>
    <button class="world-plan-route" type="button" data-world-plan>${stopCount ? `Plan route \u00b7 ${stopCount}` : "Plan route"}</button>
  `;
};

export const WorldPage = ({ selectedFilters, lockedFilters = [] }) => `
  <section class="world-page" aria-labelledby="world-title">
    <header class="world-header">
      <div>
        <h1 id="world-title">World</h1>
        <p>Discover what is worth exploring</p>
      </div>
    </header>
    ${WorldFilterControls(selectedFilters, [], [], [], lockedFilters)}
    <div class="world-map-shell">
      <div class="world-map-frame">
        <div class="world-map staza-map" data-world-map></div>
        <ul class="world-collectible-list" aria-label="Collectibles on the map" data-world-collectible-list></ul>
        <a class="world-osm-attribution" href="https://www.openstreetmap.org/copyright"
          target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>
        <div class="world-map-actions">
          <button class="world-locate" type="button" data-world-locate>LOCATE ME</button>
        </div>
        <div class="world-explore-cta" data-world-explore-cta>${WorldExploreControls({ ready: false })}</div>
        <div class="world-explore-card-host" data-world-explore-card hidden></div>
        <p class="world-map-status" data-world-status role="status" hidden></p>
      </div>
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

const prefersReducedMotion = () => Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);

export const mountWorldPage = async (mountPoint, onNavigate) => {
  mountPoint.innerHTML = '<section class="world-page"><p class="world-loading" role="status">Loading World...</p></section>';

  let basemap;
  let questInstances = [];
  let grantedFilters = [];
  let lockedFilters = [];
  try {
    const [loadedBasemap, activeQuests] = await Promise.all([
      fetch("/api/world/basemap").then(responseJson),
      fetch("/api/quest-instances").then(responseJson)
    ]);
    basemap = loadedBasemap;
    questInstances = activeQuests.instances;
    // Filters are an enhancement; the World stays usable if capabilities cannot load.
    const capabilities = await fetch("/api/player/capabilities").then(responseJson).catch(() => ({}));
    grantedFilters = capabilities.worldFilters ?? [];
    lockedFilters = capabilities.lockedWorldFilters ?? [];
  } catch (error) {
    mountPoint.innerHTML = `<section class="world-page"><p class="world-load-error" role="alert">Unable to load World: ${escapeHtml(error.message)}</p></section>`;
    return;
  }

  let selectedFilters = [];
  /** Rendered collectibles: the player's collected ones plus the Explore session's opportunities. */
  let collectibles = [];
  let worldCollectibles = [];
  let pendingQuestId;
  let truncated = false;
  /** Rendered Flowlines: completed ones in the viewport plus the Explore session's opportunities. */
  let fartleks = [];
  let completedFartleks = [];
  /**
   * The Explore session: opportunities shown only until it ends (close, new Explore, save).
   * Nothing in it is persisted; `{ bbox, view, flowlines, collectibles }` or undefined.
   */
  let session;
  /** Every saved Exploration route in view; drawn dotted whatever its status. */
  let explorationRoutes = [];
  let availableFilters = availableWorldFilters(collectibles, fartleks, grantedFilters);
  let selection;
  let selectedQuestKey;
  let selectedQuestTargets = { collectibles: [], flowlines: [] };
  let questSelectionToken = 0;
  let requestToken = 0;
  /** Collectible cache: the wide area last loaded, so panning inside it never reloads icons. */
  let loadedArea;
  let worldMap;
  let homePosition;
  /** Explore this area: undefined, or the exploring / result / error card. */
  let explore;
  let exploreToken = 0;
  /** Session Flowlines that are still waiting for their staggered appearance. */
  const revealing = new Set();
  /** Side panel replacing the detail card: "discoveries" or "planner". */
  let panel;
  let discoveriesSort = "flow";
  /** Manual route planner while open; `draftStops` keeps "Add to route" picks while it is closed. */
  let planner;
  let draftStops = [];
  let plannerToken = 0;
  const plannedRoutes = new Map();

  mountPoint.innerHTML = WorldPage({ selectedFilters, lockedFilters });
  const mapContainer = mountPoint.querySelector("[data-world-map]");
  const statusHost = mountPoint.querySelector("[data-world-status]");
  const statsHost = mountPoint.querySelector("[data-world-stats]");
  const questHost = mountPoint.querySelector("[data-world-quests]");
  const detailHost = mountPoint.querySelector("[data-world-detail]");
  const collectibleListHost = mountPoint.querySelector("[data-world-collectible-list]");
  const ctaHost = mountPoint.querySelector("[data-world-explore-cta]");
  const exploreCardHost = mountPoint.querySelector("[data-world-explore-card]");
  mountPoint.querySelectorAll("[data-world-filter-unlock]").forEach((button) => {
    button.addEventListener("click", () => onNavigate?.(button.dataset.worldFilterUnlock));
  });
  const setStatus = (message) => {
    statusHost.hidden = !message;
    statusHost.textContent = message ?? "";
  };

  const collectibleById = (id) => collectibles.find((collectible) => collectible.id === id);
  const fartlekById = (id) => fartleks.find((fartlek) => fartlek.id === id);
  const currentStops = () => planner?.stops ?? draftStops;
  const routeFlowlineIds = () => currentStops().filter((stop) => stop.kind === "flowline").map((stop) => stop.id);
  const routeCollectibleIds = () => currentStops().filter((stop) => stop.kind === "collectible").map((stop) => stop.id);
  const shownFartleks = () => fartleks.filter((fartlek) => !revealing.has(fartlek.id));

  const renderCollectibles = () => {
    const selectedCollectibleId = selection?.kind === "collectible" ? selection.id : undefined;
    const selectedFartlekId = selection?.kind === "fartlek" ? selection.id : undefined;
    if (planner) {
      // Planner: collectibles stay visible, revealed Flowlines are opportunities, chosen stops highlighted.
      const mapped = mappedWorldCollectibles(collectibles, selectedFilters, []);
      worldMap?.setCollectibles(collectiblesToFeatureCollection(mapped, { questCollectibleIds: routeCollectibleIds() }));
      worldMap?.setFartleks(fartleksToFeatureCollection(shownFartleks(), { questTargetIds: routeFlowlineIds() }));
      renderCollectibleList(mapped, undefined, shownFartleks(), undefined);
      return;
    }
    const questCollectibleIds = selectedQuestKey
      ? selectedQuestTargets.collectibles.map((collectible) => collectible.id)
      : undefined;
    const mapped = mappedWorldCollectibles(collectibles, selectedFilters, selectedQuestTargets.collectibles);
    worldMap?.setCollectibles(collectiblesToFeatureCollection(mapped, {
      selectedId: selectedCollectibleId,
      questCollectibleIds
    }));

    const questFlowlineIds = selectedQuestKey
      ? selectedQuestTargets.flowlines.map((flowline) => flowline.id)
      : undefined;
    const mappedFartleks = mappedWorldFartleks(shownFartleks(), selectedFilters, selectedQuestTargets.flowlines);
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
          aria-pressed="${fartlek.id === selectedFartlekId}" data-user-content>${escapeHtml(fartlek.name)}, ${fartlek.completed ? "completed" : "unridden"}</button>
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

  const renderControls = () => {
    ctaHost.hidden = Boolean(planner);
    ctaHost.innerHTML = WorldExploreControls({ busy: explore?.phase === "exploring", stopCount: draftStops.length });
    ctaHost.querySelector("[data-world-explore]")?.addEventListener("click", () => void exploreArea());
    ctaHost.querySelector("[data-world-plan]")?.addEventListener("click", () => openPlanner());
    exploreCardHost.hidden = !explore || Boolean(planner);
    exploreCardHost.innerHTML = explore && !planner ? ExploreResultCard(explore) : "";
    const on = (selector, handler) => exploreCardHost.querySelectorAll(selector).forEach((button) => button.addEventListener("click", handler));
    on("[data-explore-close]", () => closeExploreCard());
    on("[data-explore-zoom-out]", () => {
      const view = worldMap.getView();
      closeExploreCard();
      worldMap.flyTo(view.center.lon, view.center.lat, Math.max(0, view.zoom - 2));
    });
    exploreCardHost.querySelectorAll("[data-explore-intent]").forEach((button) => button.addEventListener("click", () => {
      if (explore?.phase !== "result") return;
      explore.intent = button.dataset.exploreIntent;
      renderControls();
    }));
    on("[data-explore-generate]", () => void generateRoute());
    on("[data-explore-discoveries]", () => openDiscoveries());
  };

  const hideDetail = () => {
    detailHost.hidden = true;
    detailHost.innerHTML = "";
    worldMap?.setDetailPanelOpen(false);
  };

  const relatedInstances = (collectibleId) => questInstances
    .filter((instance) => instance.objectives.some(({ objective }) =>
      objective.type !== "flowline_rule" && objective.targets.some((target) => target.id === collectibleId)))
    .map((instance) => ({ id: `instance:${instance.id}`, title: instance.title }));

  const showPanel = (markup) => {
    detailHost.hidden = false;
    worldMap?.setDetailPanelOpen(true);
    detailHost.innerHTML = markup;
  };

  const bindRouteButtons = () => {
    detailHost.querySelectorAll("[data-flowline-add-route]").forEach((button) => {
      button.addEventListener("click", () => toggleFlowlineStop(button.dataset.flowlineAddRoute));
    });
  };

  const renderDetail = () => {
    renderControls();
    if (planner) {
      showPanel(RoutePlannerPanel(planner));
      bindPlanner();
      return;
    }
    if (panel === "discoveries") {
      showPanel(DiscoveriesPanel({
        flowlines: session?.flowlines ?? [],
        collectibles: session?.collectibles ?? [],
        sort: discoveriesSort,
        origin: homePosition,
        routeStopIds: routeFlowlineIds()
      }));
      detailHost.querySelector("[data-discoveries-close]")?.addEventListener("click", () => {
        panel = undefined;
        selection = undefined;
        endSession();
      });
      detailHost.querySelectorAll("[data-discoveries-sort]").forEach((button) => button.addEventListener("click", () => {
        discoveriesSort = button.dataset.discoveriesSort;
        renderDetail();
      }));
      detailHost.querySelectorAll("[data-discovery-view]").forEach((button) => button.addEventListener("click", () => {
        const fartlek = fartlekById(button.dataset.discoveryView);
        if (!fartlek) return;
        selection = { kind: "fartlek", id: fartlek.id };
        renderCollectibles();
        worldMap.fitTo(geometryPoints(fartlek.geometry));
      }));
      detailHost.querySelector("[data-discoveries-generate]")?.addEventListener("click", () => void generateRoute());
      detailHost.querySelector("[data-discoveries-plan]")?.addEventListener("click", () => openPlanner());
      bindRouteButtons();
      return;
    }
    if (!selection) {
      hideDetail();
      return;
    }
    if (selection.kind === "fartlek") {
      const fartlek = fartlekById(selection.id);
      if (!fartlek) {
        hideDetail();
        return;
      }
      showPanel(FartlekDetail(fartlek, { inRoute: routeFlowlineIds().includes(fartlek.id) }));
    } else {
      const collectible = collectibleById(selection.id);
      if (!collectible) {
        hideDetail();
        return;
      }
      showPanel(CollectibleDetail(collectible, relatedInstances(collectible.id), {
        distanceMeters: homePosition ? distanceBetween(homePosition, collectible) : undefined,
        origin: homePosition,
        locale: getAppLocale()
      }));
    }
    detailHost.querySelectorAll("[data-collectible-quest]").forEach((button) => {
      button.addEventListener("click", () => void selectQuest(button.dataset.collectibleQuest));
    });
    detailHost.querySelector("[data-collectible-route]")?.addEventListener("click", (event) => planToCollectible(event.currentTarget.dataset.collectibleRoute));
    bindRouteButtons();
    detailHost.querySelector("[data-world-close]")?.addEventListener("click", clearSelection);
    detailHost.querySelectorAll("[data-world-marker]").forEach((button) => {
      button.addEventListener("click", () => selectCollectible(button.dataset.worldMarker));
    });
  };

  const renderSidePanels = () => {
    statsHost.innerHTML = WorldStats(truncated);
    questHost.innerHTML = QuestList(questInstances, pendingQuestId, selectedQuestKey, plannedRoutes);
    questHost.querySelectorAll("[data-quest-start]").forEach((button) => {
      button.addEventListener("click", () => void startQuest(button.dataset.questStart));
    });
    questHost.querySelectorAll("[data-quest-delete]").forEach((button) => {
      button.addEventListener("click", () => void deleteQuest(button.dataset.questDelete));
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
    if (planner) {
      if (planner.adding === "collectible") toggleCollectibleStop(id);
      return;
    }
    selection = selection?.kind === "collectible" && selection.id === id
      ? undefined
      : { kind: "collectible", id };
    panel = undefined;
    renderCollectibles();
    renderDetail();
  }

  function selectFartlek(id) {
    if (planner) {
      if (planner.adding === "flowline") toggleFlowlineStop(id);
      return;
    }
    selection = selection?.kind === "fartlek" && selection.id === id
      ? undefined
      : { kind: "fartlek", id };
    if (panel !== "discoveries") panel = undefined;
    renderCollectibles();
    renderDetail();
  }

  async function selectQuest(key) {
    if (planner) return;
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
    panel = undefined;
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

  /** Routes on the map: the planner's routed proposal while planning, otherwise the selected quest's PlannedRoute. */
  function syncRouteLayers() {
    if (!worldMap) return;
    worldMap.setPickHandler(planner?.picking ? pickPlannerPoint : undefined);
    worldMap.setMapClickHandler(planner?.adding === "waypoint" && planner.status === "idle" ? addPlannerWaypoint : undefined);
    worldMap.setAlternateRoutes([]);
    if (planner) {
      worldMap.setRouteEndpoints({
        start: planner.start,
        end: planner.routeType === "point_to_point" ? planner.end : undefined
      });
      worldMap.setRoute(planner.proposal ? { geometry: planner.proposal.geometry } : undefined);
      return;
    }
    const instanceId = selectedQuestKey?.startsWith("instance:") ? selectedQuestKey.slice("instance:".length) : undefined;
    const plannedRoute = instanceId ? plannedRoutes.get(instanceId) : undefined;
    worldMap.setRouteEndpoints(plannedRoute ? {
      start: plannedRoute.start,
      end: plannedRoute.routeType === "point_to_point" ? plannedRoute.end : undefined
    } : {});
    worldMap.setRoute(plannedRoute ? { geometry: plannedRoute.geometry } : undefined);
  }

  const renderAll = () => {
    syncRouteLayers();
    renderCollectibles();
    renderDetail();
  };

  /* ---------- Explore this area: a temporary session of opportunities ---------- */

  function closeExploreCard() {
    exploreToken += 1;
    explore = undefined;
    endSession();
  }

  /** Persistent world (collected / completed) plus the session's opportunities, without duplicates. */
  function mergeWorld() {
    const completed = new Set(completedFartleks.map((fartlek) => fartlek.id));
    fartleks = [...completedFartleks, ...(session?.flowlines ?? []).filter((fartlek) => !completed.has(fartlek.id))];
    const collected = new Set(worldCollectibles.map((collectible) => collectible.id));
    collectibles = [...worldCollectibles, ...(session?.collectibles ?? []).filter((collectible) => !collected.has(collectible.id))];
    availableFilters = availableWorldFilters(collectibles, fartleks, grantedFilters);
    selectedFilters = selectedFilters.filter((filter) => availableFilters.has(filter));
  }

  /** Ends the Explore session: its opportunities disappear; nothing was saved. */
  function endSession() {
    worldMap?.setExploreFrame?.(undefined);
    if (session) {
      session = undefined;
      revealing.clear();
      mergeWorld();
      if (selection && !(selection.kind === "fartlek" ? fartlekById(selection.id) : collectibleById(selection.id))) selection = undefined;
      renderFilters();
    }
    renderCollectibles();
    renderDetail();
  }

  /** Session Flowlines appear one after another (at once with reduced motion). */
  function showSession() {
    const shown = new Set(fartleks.map((fartlek) => fartlek.id));
    mergeWorld();
    renderFilters();
    const steps = revealSequence(session.flowlines.filter((flowline) => !shown.has(flowline.id)), { reducedMotion: prefersReducedMotion() });
    for (const { flowline, delayMs } of steps) {
      if (delayMs === 0) continue;
      revealing.add(flowline.id);
      setTimeout(() => {
        revealing.delete(flowline.id);
        renderCollectibles();
      }, delayMs);
    }
    renderCollectibles();
  }

  async function exploreArea() {
    if (!worldMap || planner || explore?.phase === "exploring") return;
    const token = ++exploreToken;
    selection = undefined;
    panel = undefined;
    session = undefined;
    revealing.clear();
    mergeWorld();
    explore = { phase: "exploring" };
    renderCollectibles();
    renderDetail();
    worldMap.setExploreFrame?.(undefined);
    const viewBbox = boundsToParameter(worldMap.getBounds());
    const view = worldMap.getView();
    try {
      const result = await jsonRequest("POST", "/api/world/explore", { bbox: viewBbox });
      if (token !== exploreToken) return;
      explore = { phase: "result", result, intent: DEFAULT_ROUTE_INTENT };
      // Wide viewports explore a centered max-size frame; the session (and Generate) use that frame.
      const bbox = result.area?.bbox ?? viewBbox;
      const center = result.area?.center ?? view.center;
      session = { bbox, view: { center, zoom: view.zoom }, flowlines: result.flowlines ?? [], collectibles: result.collectibles ?? [] };
      if (result.area?.clamped) worldMap.setExploreFrame?.(bbox);
      showSession();
    } catch (error) {
      if (token !== exploreToken) return;
      explore = { phase: "error", error: error.message };
    }
    renderControls();
  }

  function openDiscoveries() {
    exploreToken += 1;
    explore = undefined;
    selection = undefined;
    panel = "discoveries";
    renderCollectibles();
    renderDetail();
  }

  /* ---------- "Add to route" and the manual planner ---------- */

  function setStops(stops, error) {
    if (planner) {
      Object.assign(planner, { stops, proposal: undefined, error });
      renderAll();
      return;
    }
    draftStops = stops;
    if (error) setStatus(error);
    renderCollectibles();
    renderDetail();
  }

  function toggleFlowlineStop(id) {
    const fartlek = fartlekById(id) ?? undefined;
    const existing = currentStops().find((stop) => stop.kind === "flowline" && stop.id === id);
    const stop = existing ?? (fartlek ? flowlineStop(fartlek) : undefined);
    if (!stop) return;
    setStops(toggleStop(currentStops(), stop));
  }

  function toggleCollectibleStop(id) {
    const collectible = collectibleById(id);
    if (!collectible) return;
    setStops(toggleStop(currentStops(), collectibleStop(collectible)));
  }

  /** A collectible's "Add to route": adds it and opens the planner. */
  function planToCollectible(id) {
    const collectible = collectibleById(id);
    if (!collectible) return;
    const stop = collectibleStop(collectible);
    if (!currentStops().some((item) => item.kind === "collectible" && item.id === id)) {
      draftStops = toggleStop(currentStops(), stop);
    }
    openPlanner();
  }

  /** Opens the manual planner; earlier "Add to route" picks become its first stops. */
  function openPlanner({ start, intent } = {}) {
    if (!worldMap || planner) return;
    exploreToken += 1;
    explore = undefined;
    panel = undefined;
    selection = undefined;
    selectedQuestKey = undefined;
    selectedQuestTargets = { collectibles: [], flowlines: [] };
    planner = createPlannerState({
      start: start ?? (homePosition ? { lat: homePosition.latitude, lon: homePosition.longitude } : undefined),
      stops: draftStops,
      intent
    });
    setStatus(undefined);
    renderSidePanels();
    renderAll();
  }

  /** Closes the planner without persisting anything; the Explore session ends with it. */
  function closePlanner() {
    plannerToken += 1;
    draftStops = planner?.stops ?? draftStops;
    planner = undefined;
    syncRouteLayers();
    endSession();
  }

  /**
   * The generated route starts at the last located position when it lies in the explored area.
   * Otherwise there is no start: the planner asks the player to tap one before generating.
   */
  const generateStart = () => {
    const [west, south, east, north] = session.bbox.split(",").map(Number);
    if (homePosition && boundsContain({ west, south, east, north }, {
      west: homePosition.longitude, east: homePosition.longitude, south: homePosition.latitude, north: homePosition.latitude
    })) return { lat: homePosition.latitude, lon: homePosition.longitude };
    return undefined;
  };

  /** "Generate route": the primary step after Explore; opens the editor with one route of the chosen feel. */
  async function generateRoute() {
    if (!session || planner) return;
    const intent = explore?.intent ?? DEFAULT_ROUTE_INTENT;
    const start = generateStart();
    draftStops = [];
    // No start means the planner opens picking one (and Generate stays disabled until it is set).
    if (start) openPlanner({ start, intent });
    else {
      openPlanner({ intent });
      if (planner) Object.assign(planner, { start: undefined, picking: "start" });
      renderAll();
      return;
    }
    await suggestRoute();
  }

  function pickPlannerPoint(point) {
    if (!planner?.picking) return;
    if (planner.picking === "end") planner.end = point;
    else planner.start = point;
    planner.picking = planner.routeType === "point_to_point" && !planner.end ? "end" : undefined;
    Object.assign(planner, { proposal: undefined, error: undefined });
    renderAll();
  }

  function addPlannerWaypoint(point) {
    if (planner?.adding !== "waypoint" || planner.status !== "idle") return;
    setStops(toggleStop(planner.stops, waypointStop(point)));
  }

  function locatePlannerStart() {
    const geolocation = globalThis.navigator?.geolocation;
    if (!geolocation) {
      planner.error = "Location is not available in this browser. Select your start on the map.";
      renderDetail();
      return;
    }
    geolocation.getCurrentPosition(
      (position) => {
        if (!planner) return;
        planner.picking = "start";
        pickPlannerPoint({ lat: position.coords.latitude, lon: position.coords.longitude });
      },
      () => {
        if (!planner) return;
        planner.error = "Location permission was denied. Select your start on the map.";
        renderDetail();
      }
    );
  }

  /** "Route": connects exactly the chosen stops. */
  async function routePlanner() {
    if (!planner || planner.status !== "idle") return;
    const { body, error } = buildPlanRequest(planner);
    if (error) {
      planner.error = error;
      renderDetail();
      return;
    }
    const token = ++plannerToken;
    Object.assign(planner, { status: "routing", adding: undefined, picking: undefined, error: undefined });
    renderAll();
    try {
      const result = await jsonRequest("POST", "/api/explorations/plan", body);
      if (token !== plannerToken || !planner) return;
      Object.assign(planner, {
        status: "idle",
        proposal: result.proposal,
        stops: planner.keepOrder ? planner.stops : orderStops(planner.stops, result.proposal.stopOrder)
      });
      worldMap.fitTo(geometryPoints(result.proposal.geometry));
    } catch (routeError) {
      if (token !== plannerToken || !planner) return;
      Object.assign(planner, { status: "idle", error: explorationErrorMessage(routeError) });
    }
    renderAll();
  }

  /** "Generate route": proposes stops for the explored (or visible) area, which the player can then edit. */
  async function suggestRoute() {
    if (!planner || planner.status !== "idle") return;
    const view = session?.view ?? worldMap.getView();
    const bbox = session?.bbox ?? boundsToParameter(worldMap.getBounds());
    const { body, error } = buildSuggestRequest(planner, { bbox, center: view.center, zoom: view.zoom });
    if (error) {
      planner.error = error;
      renderDetail();
      return;
    }
    const token = ++plannerToken;
    Object.assign(planner, { status: "suggesting", adding: undefined, picking: undefined, error: undefined });
    renderAll();
    try {
      const result = await jsonRequest("POST", "/api/explorations/generate", body);
      if (token !== plannerToken || !planner) return;
      const [suggestion] = result.proposals;
      if (!suggestion) throw new Error("No route could be suggested here. Add stops yourself.");
      const opportunities = new Map(result.catalog.flowlines.filter((flowline) => !flowline.completed).map((flowline) => [flowline.id, flowline]));
      const flowlineStops = [...new Set((suggestion.traversedFlowlines ?? []).map((flowline) => flowline.id))]
        .map((id) => opportunities.get(id))
        .filter(Boolean)
        .map(flowlineStop);
      const stops = [
        ...suggestion.includedTargetIds
          .map((id) => result.catalog.collectibles.find((item) => item.id === id))
          .filter(Boolean)
          .map(collectibleStop),
        ...flowlineStops
      ];
      Object.assign(planner, { status: "idle", stops, keepOrder: false, routeType: "round_trip", proposal: suggestion });
      worldMap.fitTo(geometryPoints(suggestion.geometry));
    } catch (suggestError) {
      if (token !== plannerToken || !planner) return;
      Object.assign(planner, { status: "idle", error: explorationErrorMessage(suggestError) });
    }
    renderAll();
  }

  const reloadQuestInstances = async () => {
    questInstances = (await fetch("/api/quest-instances").then(responseJson)).instances;
  };

  /** "Save Exploration": the only persistence step; saves the routed plan as a planned Exploration. */
  async function savePlan() {
    if (!planner?.proposal || planner.status !== "idle") return;
    const token = ++plannerToken;
    Object.assign(planner, { status: "saving", error: undefined });
    renderDetail();
    try {
      const { instance, plannedRoute } = await jsonRequest("POST", "/api/explorations/save", { proposalId: planner.proposal.id });
      if (token !== plannerToken || !planner) return;
      plannedRoutes.set(instance.id, plannedRoute ?? null);
      if (plannedRoute?.geometry && !explorationRoutes.some((route) => route.id === instance.id)) {
        explorationRoutes = [...explorationRoutes, { id: instance.id, title: instance.title, status: instance.status, geometry: plannedRoute.geometry }];
        worldMap.setSavedRoutes(explorationRoutes);
      }
      await reloadQuestInstances();
      planner = undefined;
      draftStops = [];
      session = undefined;
      worldMap.setExploreFrame?.(undefined);
      revealing.clear();
      mergeWorld();
      renderFilters();
      renderAll();
      await selectQuest(`instance:${instance.id}`);
    } catch (saveError) {
      if (token !== plannerToken || !planner) return;
      Object.assign(planner, {
        status: "idle",
        error: explorationErrorMessage(saveError),
        ...(expiredCodes.has(saveError.code) ? { proposal: undefined } : {})
      });
      renderAll();
    }
  }

  function bindPlanner() {
    const on = (selector, handler) => detailHost.querySelectorAll(selector).forEach((element) => {
      element.addEventListener("click", () => handler(element));
    });
    const edit = (change) => {
      if (planner.status !== "idle") return;
      change();
      planner.error = undefined;
      renderAll();
    };
    on("[data-planner-close]", () => closePlanner());
    on("[data-planner-intent]", (button) => edit(() => {
      planner.intent = button.dataset.plannerIntent;
    }));
    on("[data-planner-sport]", (button) => edit(() => {
      planner.sport = button.dataset.plannerSport;
      planner.proposal = undefined;
    }));
    on("[data-planner-pick]", (button) => edit(() => {
      planner.adding = undefined;
      planner.picking = planner.picking === button.dataset.plannerPick ? undefined : button.dataset.plannerPick;
    }));
    on("[data-planner-locate]", () => locatePlannerStart());
    on("[data-planner-route-type]", (button) => edit(() => {
      planner.routeType = button.dataset.plannerRouteType;
      planner.proposal = undefined;
      planner.picking = planner.routeType === "point_to_point" && !planner.end ? "end" : undefined;
    }));
    on("[data-planner-add]", (button) => edit(() => {
      planner.picking = undefined;
      planner.adding = planner.adding === button.dataset.plannerAdd ? undefined : button.dataset.plannerAdd;
    }));
    on("[data-planner-move]", (button) => edit(() => {
      const [index, offset] = button.dataset.plannerMove.split(":").map(Number);
      planner.stops = moveStop(planner.stops, index, offset);
      planner.keepOrder = true;
      planner.proposal = undefined;
    }));
    on("[data-planner-remove]", (button) => edit(() => {
      planner.stops = planner.stops.filter((_stop, index) => index !== Number(button.dataset.plannerRemove));
      planner.proposal = undefined;
    }));
    on("[data-planner-route]", () => void routePlanner());
    on("[data-planner-suggest]", () => void suggestRoute());
    on("[data-planner-save]", () => void savePlan());
  }

  /** "Start Exploration": separate from saving; activities count from now on. */
  async function startQuest(instanceId) {
    if (pendingQuestId) return;
    pendingQuestId = instanceId;
    renderSidePanels();
    try {
      await fetch(`/api/quest-instances/${encodeURIComponent(instanceId)}/start`, { method: "POST" }).then(responseJson);
      await reloadQuestInstances();
    } catch (error) {
      setStatus(error.message);
    } finally {
      pendingQuestId = undefined;
      renderSidePanels();
    }
  }

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
        const retained = worldCollectibles.filter((item) => !loadedIds.has(item.id)
          && boundsContain(keep, { west: item.longitude, east: item.longitude, south: item.latitude, north: item.latitude }));
        worldCollectibles = [...snapshot.collectibles, ...retained];
      }
      truncated = loadedArea.truncated || snapshot.fartlekTruncated === true;
      completedFartleks = snapshot.fartleks ?? [];
      explorationRoutes = snapshot.explorationRoutes ?? [];
      worldMap?.setSavedRoutes(explorationRoutes);
      mergeWorld();
      setStatus(undefined);
      if (selection?.kind === "collectible" && !collectibleById(selection.id)) selection = undefined;
      if (selection?.kind === "fartlek" && !fartlekById(selection.id)) selection = undefined;
      renderFilters();
      renderCollectibles();
      renderSidePanels();
      renderDetail();
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
      renderDetail();
    });
  });

  renderSidePanels();

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
      onFartlekSelect: (id) => selectFartlek(id)
    });
  } catch (error) {
    mapContainer.innerHTML = `<p class="world-load-error" role="alert">Unable to load the map: ${escapeHtml(error.message)}</p>`;
    return;
  }

  renderControls();

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
        homePosition = location;
        worldMap.setHomePosition(location);
        worldMap.flyTo(location.longitude, location.latitude, homeScaleZoom(location.latitude));
      },
      () => setStatus("Location permission was denied. Pan and zoom to explore.")
    );
  });

  await loadViewport(worldMap.getBounds());
};
