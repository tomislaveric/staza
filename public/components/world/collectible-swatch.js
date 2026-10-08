import { canonicalRarity } from "../collected-list.js";

/**
 * One marker vocabulary shared by the World filters and the quest collectible rows:
 * fill encodes discovery/category, ring encodes rarity — exactly like the MapLibre layers.
 */
export const CollectibleSwatch = ({ visited = false, rarity, category, selected = false } = {}) => {
  const tier = canonicalRarity(rarity) ?? "common";
  const classes = [
    "collectible-swatch",
    visited ? "is-visited" : "is-unvisited",
    `is-${tier}`,
    category ? `is-${category}` : "",
    selected ? "is-selected" : ""
  ].filter(Boolean).join(" ");
  return `<b class="${classes}" aria-hidden="true"></b>`;
};
