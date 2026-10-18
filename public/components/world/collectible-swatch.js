const CATEGORY_ICONS = {
  castle: "\u26eb",
  mountain_pass: "\u26f0",
  peak: "\u25b2"
};
const SVG_CATEGORIES = new Set(["viewpoint", "place", "waterfall"]);

/**
 * One marker vocabulary shared by the World filters and the quest collectible rows:
 * category icons and discovery colors match the MapLibre layers.
 */
export const CollectibleSwatch = ({ visited = false, category, selected = false } = {}) => {
  const categoryIcon = CATEGORY_ICONS[category];
  const svgCategory = SVG_CATEGORIES.has(category) ? category : undefined;
  const classes = [
    "collectible-swatch",
    visited ? "is-visited" : "is-unvisited",
    category ? `is-${category}` : "",
    categoryIcon || svgCategory ? "is-icon" : "",
    svgCategory ? "is-svg" : "",
    selected ? "is-selected" : ""
  ].filter(Boolean).join(" ");
  const icon = svgCategory
    ? `<img class="collectible-swatch-visited" src="/assets/collectible-${svgCategory}.svg" alt=""><img class="collectible-swatch-unvisited" src="/assets/collectible-${svgCategory}-muted.svg" alt="">`
    : categoryIcon ?? "";
  return `<b class="${classes}" aria-hidden="true">${icon}</b>`;
};
