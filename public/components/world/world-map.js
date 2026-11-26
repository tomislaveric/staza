import { EMPTY_FEATURE_COLLECTION } from "../shared/map/staza-collectible-features.js";
import {
  bindCollectibleInteractions,
  ensureCollectibleLayers,
  loadCollectibleCategoryIcons,
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
import { STAZA_MAP_PALETTE } from "../shared/map/staza-map-palette.js";

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

/** Paint overrides ("layer:property") for a planned, not-yet-ridden route: blue dashes; `undefined` restores the default. */
export const routePaint = (planned) => ({
  "glow:line-color": planned ? STAZA_MAP_PALETTE.plannedRoute : STAZA_MAP_PALETTE.questRoute,
  "line:line-color": planned ? STAZA_MAP_PALETTE.plannedRoute : STAZA_MAP_PALETTE.questRoute,
  "line:line-dasharray": planned ? [1.4, 1.2] : undefined
});

const SAVED_ROUTES_SOURCE = "staza-saved-explorations";
export const SAVED_ROUTES_SOURCE_ID = SAVED_ROUTES_SOURCE;

/**
 * Every saved Exploration route, whatever its status: one dotted, low-prominence line drawn
 * beneath Flowlines and collectibles, so ridden and collected objects read on top.
 */
export const savedRouteLayers = () => [{
  id: `${SAVED_ROUTES_SOURCE}-line`,
  type: "line",
  source: SAVED_ROUTES_SOURCE,
  layout: { "line-cap": "round", "line-join": "round" },
  paint: {
    "line-color": STAZA_MAP_PALETTE.questRoute,
    "line-opacity": 0.45,
    "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.5, 12, 2.5, 16, 4],
    "line-dasharray": [0.2, 2]
  }
}];

/** One LineString feature per saved Exploration route. */
export const savedRoutesToGeoJson = (routes = []) => ({
  type: "FeatureCollection",
  features: routes
    .filter((route) => route?.geometry?.coordinates?.length)
    .map((route) => ({ type: "Feature", properties: { explorationId: route.id }, geometry: route.geometry }))
});

const EXPLORE_FRAME_SOURCE = "staza-explore-frame";
export const EXPLORE_FRAME_SOURCE_ID = EXPLORE_FRAME_SOURCE;

/** The explored frame when a wide viewport was clamped to the max Explore size: a thin dashed outline. */
export const exploreFrameLayers = () => [{
  id: `${EXPLORE_FRAME_SOURCE}-line`,
  type: "line",
  source: EXPLORE_FRAME_SOURCE,
  layout: { "line-join": "miter" },
  paint: { "line-color": STAZA_MAP_PALETTE.questRoute, "line-opacity": 0.8, "line-width": 2, "line-dasharray": [3, 2] }
}];

/** A closed outline of a "west,south,east,north" bbox; empty without one. */
export const exploreFrameToGeoJson = (bbox) => {
  const [west, south, east, north] = typeof bbox === "string" ? bbox.split(",").map(Number) : [];
  if (![west, south, east, north].every(Number.isFinite)) return EMPTY_FEATURE_COLLECTION;
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [[west, south], [east, south], [east, north], [west, north], [west, south]] }
    }]
  };
};

export {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  boundsToParameter,
  readBounds,
  routeToGeoJson
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

const documentRefOf = (container) => container.ownerDocument ?? document;

/**
 * Thin World map. It owns the World viewport events and quest-route plumbing only, over the
 * shared Staza map foundation; Staza gameplay rules stay in the World page.
 */
export const createWorldMap = async (container, {
  styleUrl, attribution, homePosition, onViewportChange, onCollectibleSelect, onCollectibleHover, onFartlekSelect
}) => {
  const staza = await createStazaMap(container, { styleUrl, attribution, ...worldMapInitialView(homePosition) });
  const { map } = staza;

  let styleReady = false;
  let pendingCollectibles = EMPTY_FEATURE_COLLECTION;
  let pendingFartleks = EMPTY_FEATURE_COLLECTION;
  let pendingSavedRoutes = [];
  let pendingExploreFrame;
  const setSavedRouteData = () => map.getSource(SAVED_ROUTES_SOURCE)?.setData(savedRoutesToGeoJson(pendingSavedRoutes));
  let panelInset = 0;
  let pickHandler;
  let routePlanned = false;
  let clickHandler;
  let pointTooltip;
  let homeMarker;

  const framingPadding = () => ({
    top: BASE_PADDING,
    bottom: BASE_PADDING,
    left: BASE_PADDING,
    right: BASE_PADDING + panelInset
  });

  const ensureSavedRouteLayers = () => {
    if (map.getSource(SAVED_ROUTES_SOURCE)) return;
    map.addSource(SAVED_ROUTES_SOURCE, { type: "geojson", data: savedRoutesToGeoJson() });
    for (const layer of savedRouteLayers()) map.addLayer(layer);
  };
  const ensureExploreFrameLayers = () => {
    if (map.getSource(EXPLORE_FRAME_SOURCE)) return;
    map.addSource(EXPLORE_FRAME_SOURCE, { type: "geojson", data: exploreFrameToGeoJson(pendingExploreFrame) });
    for (const layer of exploreFrameLayers()) map.addLayer(layer);
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
  await loadCollectibleCategoryIcons(map);
  // Saved Exploration routes are added first, so they stay beneath every other overlay.
  ensureSavedRouteLayers();
  setSavedRouteData();
  ensureExploreFrameLayers();
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
  map.on("click", (event) => {
    const point = { lat: event.lngLat.lat, lon: event.lngLat.lng };
    if (pickHandler) pickHandler(point);
    else clickHandler?.(point);
  });

  const closePointTooltip = () => {
    pointTooltip?.remove();
    pointTooltip = undefined;
  };

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
    /** All saved Exploration routes in view, drawn dotted beneath everything else. */
    setSavedRoutes(routes) {
      pendingSavedRoutes = routes ?? [];
      if (!styleReady) return;
      setSavedRouteData();
    },
    /** Outlines the clamped Explore frame ("west,south,east,north") during a session; undefined clears it. */
    setExploreFrame(bbox) {
      pendingExploreFrame = bbox;
      if (!styleReady) return;
      ensureExploreFrameLayers();
      map.getSource(EXPLORE_FRAME_SOURCE).setData(exploreFrameToGeoJson(bbox));
    },
    /** The quest route; `planned` draws a not-yet-ridden planner route in blue dashes instead. */
    setRoute(route, { planned = false } = {}) {
      if (!styleReady) return;
      ensureRouteLayers();
      map.getSource(ROUTE_SOURCE).setData(routeToGeoJson(route));
      if (planned === routePlanned) return;
      routePlanned = planned;
      for (const [key, value] of Object.entries(routePaint(planned))) {
        const [layer, property] = key.split(":");
        map.setPaintProperty(`${ROUTE_SOURCE}-${layer}`, property, value);
      }
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
    /** Receives every map click that is not a point pick or a route selection. */
    setMapClickHandler(handler) {
      clickHandler = handler;
      if (!handler) closePointTooltip();
    },
    /** Opens an "Add destination" tooltip at the coordinate; confirming reports it once. */
    showPointTooltip(point, { onConfirm, label = "Add destination" }) {
      closePointTooltip();
      const content = documentRefOf(container).createElement("div");
      content.className = "world-point-tooltip";
      const button = documentRefOf(container).createElement("button");
      button.type = "button";
      button.dataset.worldPointAdd = "";
      button.textContent = label;
      button.addEventListener("click", () => {
        closePointTooltip();
        onConfirm(point);
      });
      content.append(button);
      pointTooltip = new staza.maplibre.Popup({ closeButton: true, closeOnClick: false, offset: 12 })
        .setLngLat([point.lon, point.lat])
        .setDOMContent(content)
        .addTo(map);
      pointTooltip.on("close", () => { pointTooltip = undefined; });
    },
    closePointTooltip,
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
