import { canonicalRarity } from "../collected-list.js";

const CATEGORY_ICONS = {
  castle: "\u26eb",
  mountain_pass: "\u26f0",
  peak: "\u25b2",
  waterfall: "💦"
};

/**
 * One marker vocabulary shared by the World filters and the quest collectible rows:
 * category icons and discovery colors match the MapLibre layers.
 */
export const CollectibleSwatch = ({ visited = false, rarity, category, selected = false } = {}) => {
  const tier = canonicalRarity(rarity) ?? "common";
  const categoryIcon = CATEGORY_ICONS[category];
  const classes = [
    "collectible-swatch",
    visited ? "is-visited" : "is-unvisited",
    `is-${tier}`,
    category ? `is-${category}` : "",
    categoryIcon ? "is-icon" : "",
    selected ? "is-selected" : ""
  ].filter(Boolean).join(" ");
  return `<b class="${classes}" aria-hidden="true">${categoryIcon ?? ""}</b>`;
};
