import { escapeHtml } from "../collected-list.js";

export const markerLabel = (collectible) => `${collectible.name}, ${collectible.found ? "visited" : "unvisited"}${collectible.rarity ? `, ${collectible.rarity}` : ""}`;

export const WorldMapEmptyState = (message) => `
  <p class="world-map-empty" role="status">${escapeHtml(message)}</p>
`;
