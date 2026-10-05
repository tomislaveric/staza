import { escapeHtml } from "../collected-list.js";
import { CollectibleSwatch } from "./collectible-swatch.js";

export const markerLabel = (collectible) => `${collectible.name}, ${collectible.found ? "visited" : "unvisited"}${collectible.rarity ? `, ${collectible.rarity}` : ""}`;

/** Mirrors exactly what the collectible circle layers encode: discovery, category, and rarity. */
export const WorldLegend = () => `
  <aside class="world-legend" aria-label="World marker legend">
    <span>${CollectibleSwatch({ visited: true })}<small>Visited</small></span>
    <span>${CollectibleSwatch({ visited: false })}<small>Unvisited</small></span>
    <span>${CollectibleSwatch({ visited: false, rarity: "rare" })}<small>Rare</small></span>
    <span>${CollectibleSwatch({ visited: false, rarity: "epic" })}<small>Epic</small></span>
    <i aria-hidden="true"></i>
    <span>${CollectibleSwatch({ category: "viewpoint" })}<small>Viewpoint</small></span>
    <span>${CollectibleSwatch({ category: "peak" })}<small>Peak</small></span>
    <span>${CollectibleSwatch({ category: "castle" })}<small>Castle</small></span>
    <span>${CollectibleSwatch({ category: "waterfall" })}<small>Waterfall</small></span>
    <span>${CollectibleSwatch({ category: "place" })}<small>Place</small></span>
  </aside>
`;

export const WorldMapEmptyState = (message) => `
  <p class="world-map-empty" role="status">${escapeHtml(message)}</p>
`;
