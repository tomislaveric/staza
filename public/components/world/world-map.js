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
import { stazaRouteLayers, stazaSubduedRouteLayers } from "../shared/map/staza-route-layers.js";
import { boundsToParameter, pointsToBounds, readBounds, routeToGeoJson } from "../shared/map/staza-map-utils.js";
import { loadStazaStyle } from "../shared/map/staza-map-style.js";

/** Width reserved on the right for the detail panel so framing never hides the subject. */
const DETAIL_PANEL_INSET = 368;
const BASE_PADDING = 64;
const SCALE_CONTROL_WIDTH = 110;
const SCALE_BAR_TARGET_DISTANCE_METERS = 6_250;
const EARTH_RADIUS_METERS = 6_371_008.8;
const MAX_MERCATOR_LATITUDE = 85.051129;

const ROUTE_SOURCE = "staza-quest-route";
export const ROUTE_SOURCE_ID = ROUTE_SOURCE;
const ENDPOINT_SOURCE = "staza-quest-route-endpoints";
export const ENDPOINT_SOURCE_ID = ENDPOINT_SOURCE;

/** Start/destination markers for quest route planning; the start is ringed, the destination solid. */
export const endpointLayers = () => [{
  id: `${ENDPOINT_SOURCE}-circle`,
  type: "circle",
  source: ENDPOINT_SOURCE,
  paint: {
    "circle-radius": 7,
    "circle-color": ["match", ["get", "kind"], "start", "#101418", "#e8b80a"],
    "circle-stroke-color": "#e8b80a",
    "circle-stroke-width": 3
  }
}];

/** GeoJSON for planning endpoints; a round trip shows only the start. */
export const endpointsToGeoJson = ({ start, end } = {}) => ({
  type: "FeatureCollection",
  features: [
    ...(start ? [{ type: "Feature", properties: { kind: "start" }, geometry: { type: "Point", coordinates: [start.lon, start.lat] } }] : []),
    ...(end && (!start || end.lat !== start.lat || end.lon !== start.lon)
      ? [{ type: "Feature", properties: { kind: "end" }, geometry: { type: "Point", coordinates: [end.lon, end.lat] } }]
      : [])
  ]
});

/** The World quest route uses the shared Staza route vocabulary at the quest accent. */
export const routeLayers = () => stazaRouteLayers(ROUTE_SOURCE);

const ALTERNATES_SOURCE = "staza-exploration-alternates";
export const ALTERNATES_SOURCE_ID = ALTERNATES_SOURCE;

/** Unselected exploration route proposals: muted context under the selected route. */
export const alternateRouteLayers = () => stazaSubduedRouteLayers(ALTERNATES_SOURCE, { color: "#c9b46a", opacity: 0.55 });

/** One LineString feature per unselected proposal, tagged with its proposal id for selection. */
export const alternateRoutesToGeoJson = (routes = []) => ({
  type: "FeatureCollection",
  features: routes
    .filter((route) => route?.geometry?.coordinates?.length)
    .map((route) => ({ type: "Feature", properties: { proposalId: route.id }, geometry: route.geometry }))
});

export {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  boundsToParameter,
  readBounds,
  routeToGeoJson,
  loadStazaStyle
};

/** Zoom at which the metric scale control rounds to a 5 km label. */
export const homeScaleZoom = (latitude) => {
  const clampedLatitude = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, latitude));
  const latitudeScale = Math.cos(clampedLatitude * Math.PI / 180);
  const metersPerWorld = 2 * Math.PI * EARTH_RADIUS_METERS;
  return Math.log2((latitudeScale * metersPerWorld * SCALE_CONTROL_WIDTH)
    / (512 * SCALE_BAR_TARGET_DISTANCE_METERS));
};

export const worldMapInitialView = (homePosition) => homePosition
  ? {
    center: { longitude: homePosition.longitude, latitude: homePosition.latitude },
    zoom: homeScaleZoom(homePosition.latitude)
  }
  : { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM };

export const createHomeMarkerElement = (documentRef = globalThis.document) => {
  const marker = documentRef.createElement("div");
  marker.className = "world-home-marker";
  marker.setAttribute("role", "img");
  marker.setAttribute("aria-label", "Saved home location");

  const icon = documentRef.createElement("img");
  icon.src = "/assets/nav-home.svg";
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  marker.append(icon);
  return marker;
};

/**
 * Thin World map. It owns the World viewport events and quest-route plumbing only, over the
 * shared Staza map foundation; Staza gameplay rules stay in the World page.
 */
export const createWorldMap = async (container, {
  styleUrl, attribution, homePosition, onViewportChange, onCollectibleSelect, onCollectibleHover, onFartlekSelect, onAlternateRouteSelect
}) => {
  const staza = await createStazaMap(container, { styleUrl, attribution, ...worldMapInitialView(homePosition) });
  const { map } = staza;

  let styleReady = false;
  let pendingCollectibles = EMPTY_FEATURE_COLLECTION;
  let pendingFartleks = EMPTY_FEATURE_COLLECTION;
  let panelInset = 0;
  let pickHandler;
  let homeMarker;

  const framingPadding = () => ({
    top: BASE_PADDING,
    bottom: BASE_PADDING,
    left: BASE_PADDING,
    right: BASE_PADDING + panelInset
  });

  const ensureAlternateLayers = () => {
    if (map.getSource(ALTERNATES_SOURCE)) return;
    map.addSource(ALTERNATES_SOURCE, { type: "geojson", data: alternateRoutesToGeoJson() });
    for (const layer of alternateRouteLayers()) map.addLayer(layer);
  };
  const ensureRouteLayers = () => {
    if (map.getSource(ROUTE_SOURCE)) return;
    map.addSource(ROUTE_SOURCE, { type: "geojson", data: routeToGeoJson() });
    for (const layer of routeLayers()) map.addLayer(layer);
  };
  const ensureEndpointLayers = () => {
    if (map.getSource(ENDPOINT_SOURCE)) return;
    map.addSource(ENDPOINT_SOURCE, { type: "geojson", data: endpointsToGeoJson() });
    for (const layer of endpointLayers()) map.addLayer(layer);
  };

  map.addControl(new staza.maplibre.ScaleControl({ maxWidth: SCALE_CONTROL_WIDTH, unit: "metric" }), "bottom-left");

  await staza.ready;
  styleReady = true;
  ensureAlternateLayers();
  ensureRouteLayers();
  ensureEndpointLayers();
  // Fartlek segment layers draw above routes/activity layers but under point collectibles.
  ensureFartlekLayers(map);
  setFartlekData(map, pendingFartleks);
  ensureCollectibleLayers(map);
  setCollectibleData(map, pendingCollectibles);

  const setHomePosition = (position) => {
    if (!position) {
      homeMarker?.remove();
      homeMarker = undefined;
      return;
    }
    if (!homeMarker) {
      homeMarker = new staza.maplibre.Marker({ element: createHomeMarkerElement() })
        .setLngLat([position.longitude, position.latitude])
        .addTo(map);
      return;
    }
    homeMarker.setLngLat([position.longitude, position.latitude]);
  };
  setHomePosition(homePosition);

  if (onCollectibleSelect) bindCollectibleInteractions(map, { onSelect: onCollectibleSelect, onHover: onCollectibleHover });
  if (onFartlekSelect) bindFartlekInteractions(map, { onSelect: onFartlekSelect });

  map.on("moveend", () => onViewportChange(readBounds(map)));
  let alternateClicked = false;
  if (onAlternateRouteSelect) {
    // Both muted layers are clickable so the thin line is easy to hit through its casing.
    for (const { id } of alternateRouteLayers()) {
      map.on("click", id, (event) => {
        const proposalId = event.features?.[0]?.properties?.proposalId;
        if (!proposalId || pickHandler) return;
        alternateClicked = true;
        onAlternateRouteSelect(proposalId);
      });
      map.on("mouseenter", id, () => { if (!pickHandler) map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", id, () => { if (!pickHandler) map.getCanvas().style.cursor = ""; });
    }
  }
  map.on("click", (event) => {
    if (alternateClicked) {
      alternateClicked = false;
      return;
    }
    if (pickHandler) pickHandler({ lat: event.lngLat.lat, lon: event.lngLat.lng });
  });

  return {
    map,
    getBounds: () => readBounds(map),
    /** Current map center and zoom, frozen together with the bounds by "Explore this Area". */
    getView: () => {
      const center = map.getCenter();
      return { center: { lat: center.lat, lon: center.lng }, zoom: map.getZoom() };
    },
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
    /** Muted, clickable geometry of the unselected exploration proposals. */
    setAlternateRoutes(routes) {
      if (!styleReady) return;
      ensureAlternateLayers();
      map.getSource(ALTERNATES_SOURCE).setData(alternateRoutesToGeoJson(routes));
    },
    setRouteEndpoints(endpoints) {
      if (!styleReady) return;
      ensureEndpointLayers();
      map.getSource(ENDPOINT_SOURCE).setData(endpointsToGeoJson(endpoints));
    },
    setHomePosition,
    /** While set, map clicks report coordinates to the handler (route planning point picking). */
    setPickHandler(handler) {
      pickHandler = handler;
      map.getCanvas().style.cursor = handler ? "crosshair" : "";
    },
    isPicking: () => Boolean(pickHandler),
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
