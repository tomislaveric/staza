import { EMPTY_FEATURE_COLLECTION } from "../shared/map/staza-collectible-features.js";
import {
  bindCollectibleInteractions,
  ensureCollectibleLayers,
  setCollectibleData
} from "../shared/map/staza-collectible-layers.js";
import {
  bindFartlekInteractions,
  ensureFartlekLayers,
  setFartlekData
} from "../shared/map/staza-fartlek-layers.js";
import { createStazaMap, DEFAULT_CENTER, DEFAULT_ZOOM } from "../shared/map/staza-map.js";
import { stazaRouteLayers } from "../shared/map/staza-route-layers.js";
import { boundsToParameter, pointsToBounds, readBounds, routeToGeoJson } from "../shared/map/staza-map-utils.js";
import { loadStazaStyle } from "../shared/map/staza-map-style.js";

/** Width reserved on the right for the detail panel so framing never hides the subject. */
const DETAIL_PANEL_INSET = 368;
const BASE_PADDING = 64;

const ROUTE_SOURCE = "staza-quest-route";
export const ROUTE_SOURCE_ID = ROUTE_SOURCE;

/** The World quest route uses the shared Staza route vocabulary at the quest accent. */
export const routeLayers = () => stazaRouteLayers(ROUTE_SOURCE);

export {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  boundsToParameter,
  readBounds,
  routeToGeoJson,
  loadStazaStyle
};

/**
 * Thin World map. It owns the World viewport events and quest-route plumbing only, over the
 * shared Staza map foundation; Staza gameplay rules stay in the World page.
 */
export const createWorldMap = async (container, {
  styleUrl, attribution, onViewportChange, onCollectibleSelect, onFartlekSelect
}) => {
  const staza = await createStazaMap(container, { styleUrl, attribution });
  const { map } = staza;

  let styleReady = false;
  let pendingCollectibles = EMPTY_FEATURE_COLLECTION;
  let pendingFartleks = EMPTY_FEATURE_COLLECTION;
  let panelInset = 0;

  const framingPadding = () => ({
    top: BASE_PADDING,
    bottom: BASE_PADDING,
    left: BASE_PADDING,
    right: BASE_PADDING + panelInset
  });

  const ensureRouteLayers = () => {
    if (map.getSource(ROUTE_SOURCE)) return;
    map.addSource(ROUTE_SOURCE, { type: "geojson", data: routeToGeoJson() });
    for (const layer of routeLayers()) map.addLayer(layer);
  };

  await staza.ready;
  styleReady = true;
  ensureRouteLayers();
  // Fartlek segment layers draw above routes/activity layers but under point collectibles.
  ensureFartlekLayers(map);
  setFartlekData(map, pendingFartleks);
  ensureCollectibleLayers(map);
  setCollectibleData(map, pendingCollectibles);

  if (onCollectibleSelect) bindCollectibleInteractions(map, { onSelect: onCollectibleSelect });
  if (onFartlekSelect) bindFartlekInteractions(map, { onSelect: onFartlekSelect });

  map.on("moveend", () => onViewportChange(readBounds(map)));

  return {
    map,
    getBounds: () => readBounds(map),
    setCollectibles(featureCollection) {
      pendingCollectibles = featureCollection ?? EMPTY_FEATURE_COLLECTION;
      if (!styleReady) return;
      ensureCollectibleLayers(map);
      setCollectibleData(map, pendingCollectibles);
    },
    setFartleks(featureCollection) {
      pendingFartleks = featureCollection ?? EMPTY_FEATURE_COLLECTION;
      if (!styleReady) return;
      ensureFartlekLayers(map);
      setFartlekData(map, pendingFartleks);
    },
    setRoute(route) {
      if (!styleReady) return;
      ensureRouteLayers();
      map.getSource(ROUTE_SOURCE).setData(routeToGeoJson(route));
    },
    setDetailPanelOpen(open) {
      panelInset = open ? DETAIL_PANEL_INSET : 0;
    },
    fitTo(points) {
      const bounds = pointsToBounds(points);
      if (!bounds) return;
      map.fitBounds(bounds, { padding: framingPadding(), maxZoom: 15, duration: 600 });
    },
    flyTo(longitude, latitude, zoom) {
      map.flyTo({
        center: [longitude, latitude],
        zoom: zoom ?? Math.max(map.getZoom(), 13),
        offset: [-panelInset / 2, 0],
        duration: 600
      });
    },
    destroy() {
      staza.destroy();
    }
  };
};
