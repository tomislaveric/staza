import { loadStazaStyle } from "./staza-map-style.js";
import { readBounds } from "./staza-map-utils.js";

export const MAPLIBRE_MODULE = "/shared/maplibre/maplibre-gl.mjs";

export const DEFAULT_CENTER = { longitude: 8.4037, latitude: 49.0069 };
export const DEFAULT_ZOOM = 12;

/**
 * The shared Staza MapLibre core. It owns MapLibre initialization, the themed basemap, and
 * the common controls only. Feature screens (World discovery, Activity Detail replay) build
 * their own sources and layers on top; no gameplay or replay logic lives here.
 */
export const createStazaMap = async (container, {
  styleUrl,
  attribution,
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  navigation = true,
  interactive = true
} = {}) => {
  const maplibre = await import(MAPLIBRE_MODULE);
  const map = new maplibre.Map({
    container,
    style: await loadStazaStyle(styleUrl),
    center: [center.longitude, center.latitude],
    zoom,
    interactive,
    attributionControl: false
  });
  if (navigation) map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new maplibre.AttributionControl({ compact: true, customAttribution: attribution }), "bottom-right");

  const ready = new Promise((resolve) => map.on("load", () => resolve()));
  // MapLibre opens compact attribution until the first drag; start collapsed so it never covers map actions.
  ready.then(() => {
    const attributionElement = container.querySelector(".maplibregl-ctrl-attrib.maplibregl-compact");
    attributionElement?.classList.remove("maplibregl-compact-show");
    attributionElement?.removeAttribute("open");
  });

  return {
    map,
    maplibre,
    ready,
    getBounds: () => readBounds(map),
    fitBounds(bounds, options) {
      if (bounds) map.fitBounds(bounds, options);
    },
    destroy() {
      map.remove();
    }
  };
};
