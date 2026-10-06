import { getAppLocale } from "../app-locales.js";
import { escapeHtml } from "./collected-list.js";
import { markerLabel, WorldLegend } from "./world/world-markers.js";
import { collectiblesToFeatureCollection } from "./world/collectible-features.js";
import { fartleksToFeatureCollection } from "./world/fartlek-features.js";
import { boundsToParameter, createWorldMap } from "./world/world-map.js";
import { QuestList } from "./world/quest-list.js";
import { QuestDetail } from "./world/quest-detail.js";
import { CollectibleDetail } from "./world/collectible-detail.js";
import { FartlekDetail } from "./world/fartlek-detail.js";
import { mountQuestEditor } from "./world/quest-editor.js";

export const worldFilters = ["all", "found", "unfound", "rare", "epic", "fartleks"];

const filterLabels = {
  all: "All",
  found: "Found",
  unfound: "Unfound",
  rare: "Rare",
  epic: "Epic",
  fartleks: "Fartleks"
};

/** Found/Unfound/Rare/Epic and category filters apply to point collectibles only. */
const COLLECTIBLE_ONLY_FILTERS = new Set(["found", "unfound", "rare", "epic"]);

const formatNumber = (value) => new Intl.NumberFormat(getAppLocale()).format(value);

export const visibleWorldCollectibles = (collectibles) =>
  collectibles.filter((collectible) => collectible.visibility !== "hidden");

export const filteredWorldCollectibles = (collectibles, activeFilter) => visibleWorldCollectibles(collectibles).filter((collectible) => {
  if (activeFilter === "fartleks") return false;
  if (activeFilter === "found") return collectible.found;
  if (activeFilter === "unfound") return !collectible.found;
  if (activeFilter === "rare" || activeFilter === "epic") return collectible.rarity === activeFilter;
  return true;
});

/**
 * Fartleks are a distinct challenge type with their own completed/uncompleted state; the
 * collectible-only filters (Found/Unfound/Rare/Epic) leave them unaffected by hiding them
 * while one of those collectible-focused filters is active.
 */
export const filteredWorldFartleks = (fartleks, activeFilter) =>
  COLLECTIBLE_ONLY_FILTERS.has(activeFilter) ? [] : fartleks;

/** Collectibles drawn on the map: the filtered viewport set plus the selected quest's own. */
export const mappedWorldCollectibles = (collectibles, activeFilter, questCollectibles = []) => {
  const mapped = [...filteredWorldCollectibles(collectibles, activeFilter)];
  for (const collectible of questCollectibles) {
    if (!mapped.some((item) => item.id === collectible.id)) mapped.push(collectible);
  }
  return mapped;
};

export const WorldFilterTabs = (activeFilter) => `
  <div class="world-filter-tabs" role="tablist" aria-label="World collectibles">
    ${worldFilters.map((filter) => `
      <button class="${filter === activeFilter ? "is-active" : ""}" type="button" role="tab"
        aria-selected="${filter === activeFilter}" data-world-filter="${filter}">
        ${filterLabels[filter]}
      </button>
    `).join("")}
  </div>
`;

export const WorldStats = (stats, truncated) => `
  <p class="world-stats">
    <span>${formatNumber(stats.discoveredCount)} visited here</span>
    <i aria-hidden="true">\u00b7</i>
    <strong class="rarity-rare">${formatNumber(stats.rareFinds)} rare</strong>
    <i aria-hidden="true">\u00b7</i>
    <strong class="rarity-epic">${formatNumber(stats.epicFinds)} epic</strong>
    <i aria-hidden="true">\u00b7</i>
    <span>${formatNumber(stats.remainingCount)} remaining</span>
    ${truncated ? '<i aria-hidden="true">\u00b7</i><span class="world-stats-truncated">Zoom in to see everything here</span>' : ""}
  </p>
`;

export const WorldPage = ({ lifetime, activeFilter }) => `
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
    ${WorldFilterTabs(activeFilter)}
    <div class="world-map-shell">
      <div class="world-map staza-map" data-world-map></div>
      ${WorldLegend()}
      <ul class="world-collectible-list" aria-label="Collectibles on the map" data-world-collectible-list></ul>
      <a class="world-osm-attribution" href="https://www.openstreetmap.org/copyright"
        target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>
      <button class="world-locate" type="button" data-world-locate>LOCATE ME</button>
      <p class="world-map-status" data-world-status role="status" hidden></p>
      <div class="world-detail-host" data-world-detail hidden></div>
    </div>
    <div data-world-stats></div>
    <div data-world-quests></div>
    <div class="world-editor-host" data-world-editor hidden></div>
  </section>
`;

const responseJson = async (response) => {
  if (response.status === 204) return undefined;
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Unable to load World data.");
  return body;
};

const emptyStats = { totalCollectibles: 0, discoveredCount: 0, rareFinds: 0, epicFinds: 0, remainingCount: 0 };

export const mountWorldPage = async (mountPoint) => {
  mountPoint.innerHTML = '<section class="world-page"><p class="world-loading" role="status">Loading World...</p></section>';

  let basemap;
  let lifetime = emptyStats;
  try {
    const [loadedBasemap, globalSnapshot] = await Promise.all([
      fetch("/api/world/basemap").then(responseJson),
      fetch("/api/world").then(responseJson)
    ]);
    basemap = loadedBasemap;
    lifetime = globalSnapshot.stats;
  } catch (error) {
    mountPoint.innerHTML = `<section class="world-page"><p class="world-load-error" role="alert">Unable to load World: ${escapeHtml(error.message)}</p></section>`;
    return;
  }

  let activeFilter = "all";
  let collectibles = [];
  let quests = [];
  let stats = emptyStats;
  let truncated = false;
  let fartleks = [];
  let selection;
  let selectedQuest;
  let requestToken = 0;
  let worldMap;

  mountPoint.innerHTML = WorldPage({ lifetime, activeFilter });
  const mapContainer = mountPoint.querySelector("[data-world-map]");
  const statusHost = mountPoint.querySelector("[data-world-status]");
  const statsHost = mountPoint.querySelector("[data-world-stats]");
  const questHost = mountPoint.querySelector("[data-world-quests]");
  const detailHost = mountPoint.querySelector("[data-world-detail]");
  const collectibleListHost = mountPoint.querySelector("[data-world-collectible-list]");
  const editorHost = mountPoint.querySelector("[data-world-editor]");

  const setStatus = (message) => {
    statusHost.hidden = !message;
    statusHost.textContent = message ?? "";
  };

  const collectibleById = (id) => collectibles.find((collectible) => collectible.id === id)
    ?? selectedQuest?.collectibles?.find((collectible) => collectible.id === id);
  const fartlekById = (id) => fartleks.find((fartlek) => fartlek.id === id);

  const renderCollectibles = () => {
    const selectedCollectibleId = selection?.kind === "collectible" ? selection.id : undefined;
    const questCollectibles = selectedQuest?.collectibles ?? [];
    const mapped = mappedWorldCollectibles(collectibles, activeFilter, questCollectibles);
    const questCollectibleIds = selectedQuest ? questCollectibles.map((item) => item.id) : undefined;
    worldMap?.setCollectibles(collectiblesToFeatureCollection(mapped, { selectedId: selectedCollectibleId, questCollectibleIds }));

    const selectedFartlekId = selection?.kind === "fartlek" ? selection.id : undefined;
    const mappedFartleks = filteredWorldFartleks(fartleks, activeFilter);
    worldMap?.setFartleks(fartleksToFeatureCollection(mappedFartleks, { selectedId: selectedFartlekId }));

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

  const renderDetail = () => {
    if (!selection) {
      detailHost.hidden = true;
      detailHost.innerHTML = "";
      worldMap?.setDetailPanelOpen(false);
      return;
    }
    detailHost.hidden = false;
    worldMap?.setDetailPanelOpen(true);
    if (selection.kind === "quest") {
      if (!selectedQuest) {
        detailHost.innerHTML = '<section class="world-detail"><p role="status">Loading quest...</p></section>';
        return;
      }
      detailHost.innerHTML = QuestDetail(selectedQuest);
    } else if (selection.kind === "fartlek") {
      const fartlek = fartlekById(selection.id);
      if (!fartlek) {
        detailHost.hidden = true;
        detailHost.innerHTML = "";
        worldMap?.setDetailPanelOpen(false);
        return;
      }
      detailHost.innerHTML = FartlekDetail(fartlek);
    } else {
      const collectible = collectibleById(selection.id);
      if (!collectible) {
        detailHost.hidden = true;
        detailHost.innerHTML = "";
        worldMap?.setDetailPanelOpen(false);
        return;
      }
      const related = selectedQuest && (selectedQuest.collectibles ?? [])
        .some((item) => item.id === collectible.id) ? [selectedQuest] : [];
      detailHost.innerHTML = CollectibleDetail(collectible, related);
    }
    detailHost.querySelector("[data-world-close]")?.addEventListener("click", clearSelection);
    detailHost.querySelectorAll("[data-world-marker]").forEach((button) => {
      button.addEventListener("click", () => selectCollectible(button.dataset.worldMarker));
    });
    detailHost.querySelectorAll("[data-quest-card]").forEach((button) => {
      button.addEventListener("click", () => void selectQuest(button.dataset.questCard));
    });
    detailHost.querySelector("[data-quest-edit]")?.addEventListener("click", openEditor);
    detailHost.querySelector("[data-quest-status]")?.addEventListener("click", () => void toggleStatus());
  };

  const renderSidePanels = () => {
    statsHost.innerHTML = WorldStats(stats, truncated);
    questHost.innerHTML = QuestList(quests, selectedQuest?.id);
    questHost.querySelectorAll("[data-quest-card]").forEach((button) => {
      button.addEventListener("click", () => void selectQuest(button.dataset.questCard));
    });
  };

  const renderFilters = () => {
    mountPoint.querySelectorAll("[data-world-filter]").forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.worldFilter === activeFilter);
      tab.setAttribute("aria-selected", String(tab.dataset.worldFilter === activeFilter));
    });
  };

  function clearSelection() {
    selection = undefined;
    selectedQuest = undefined;
    worldMap?.setRoute(undefined);
    renderCollectibles();
    renderSidePanels();
    renderDetail();
  }

  function selectCollectible(id) {
    selection = selection?.kind === "collectible" && selection.id === id
      ? undefined
      : { kind: "collectible", id };
    renderCollectibles();
    renderDetail();
  }

  function selectFartlek(id) {
    selection = selection?.kind === "fartlek" && selection.id === id
      ? undefined
      : { kind: "fartlek", id };
    renderCollectibles();
    renderDetail();
  }

  async function selectQuest(questId) {
    if (selectedQuest?.id === questId) {
      clearSelection();
      return;
    }
    selection = { kind: "quest", id: questId };
    selectedQuest = undefined;
    renderDetail();
    try {
      selectedQuest = await fetch(`/api/quests/${encodeURIComponent(questId)}`).then(responseJson);
      worldMap?.setRoute(selectedQuest.route);
      const points = selectedQuest.collectibles.length
        ? selectedQuest.collectibles
        : (selectedQuest.route?.geometry.coordinates ?? []).map(([longitude, latitude]) => ({ longitude, latitude }));
      worldMap?.fitTo(points);
      renderCollectibles();
      renderSidePanels();
      renderDetail();
    } catch (error) {
      setStatus(error.message);
      clearSelection();
    }
  }

  async function toggleStatus() {
    if (!selectedQuest?.isOwner) return;
    const action = selectedQuest.status === "published" ? "unpublish" : "publish";
    try {
      selectedQuest = await fetch(`/api/quests/${encodeURIComponent(selectedQuest.id)}/${action}`, { method: "POST" })
        .then(responseJson);
      renderDetail();
      await loadViewport(worldMap.getBounds());
    } catch (error) {
      setStatus(error.message);
    }
  }

  function openEditor() {
    if (!selectedQuest) return;
    editorHost.hidden = false;
    mountQuestEditor(editorHost, {
      quest: selectedQuest,
      onCancel: () => {
        editorHost.hidden = true;
        editorHost.innerHTML = "";
      },
      onSaved: async (saved) => {
        editorHost.hidden = true;
        editorHost.innerHTML = "";
        selectedQuest = saved;
        worldMap?.setRoute(saved.route);
        await loadViewport(worldMap.getBounds());
        renderDetail();
      }
    });
  }

  async function loadViewport(bounds) {
    const token = ++requestToken;
    try {
      const snapshot = await fetch(`/api/world?bbox=${boundsToParameter(bounds)}`).then(responseJson);
      if (token !== requestToken) return;
      collectibles = snapshot.collectibles;
      quests = snapshot.quests;
      stats = snapshot.stats;
      truncated = snapshot.truncated;
      fartleks = snapshot.fartleks ?? [];
      setStatus(collectibles.length === 0 && quests.length === 0 && fartleks.length === 0 ? "Nothing curated here yet." : undefined);
      if (selection?.kind === "collectible" && !collectibleById(selection.id)) selection = undefined;
      if (selection?.kind === "fartlek" && !fartlekById(selection.id)) selection = undefined;
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

  mountPoint.querySelectorAll("[data-world-filter]").forEach((tab) => {
    tab.addEventListener("click", () => {
      activeFilter = tab.dataset.worldFilter;
      if (selection?.kind === "collectible"
        && !filteredWorldCollectibles(collectibles, activeFilter).some((item) => item.id === selection.id)) {
        selection = undefined;
      }
      if (selection?.kind === "fartlek"
        && !filteredWorldFartleks(fartleks, activeFilter).some((item) => item.id === selection.id)) {
        selection = undefined;
      }
      renderFilters();
      renderCollectibles();
      renderDetail();
    });
  });

  renderSidePanels();

  try {
    worldMap = await createWorldMap(mapContainer, {
      styleUrl: basemap.styleUrl,
      attribution: basemap.attribution,
      onViewportChange: scheduleViewportLoad,
      onCollectibleSelect: (id) => selectCollectible(id),
      onFartlekSelect: (id) => selectFartlek(id)
    });
  } catch (error) {
    mapContainer.innerHTML = `<p class="world-load-error" role="alert">Unable to load the map: ${escapeHtml(error.message)}</p>`;
    return;
  }

  mountPoint.querySelector("[data-world-locate]").addEventListener("click", () => {
    if (!navigator.geolocation) {
      setStatus("Location is not available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => worldMap.flyTo(position.coords.longitude, position.coords.latitude, 14),
      () => setStatus("Location permission was denied. Pan and zoom to explore.")
    );
  });

  await loadViewport(worldMap.getBounds());
};
