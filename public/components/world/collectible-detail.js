import { CollectibleIcon, escapeHtml } from "../collected-list.js";

export const relatedQuestsFor = (collectibleId, quests) =>
  quests.filter((quest) => (quest.collectibleIds ?? []).includes(collectibleId));

/**
 * Subtle, usage-proximate data-source attribution for imported collectibles. Renders a
 * clickable link to the source deeplink when available (e.g. quäldich passes under
 * ODbL). Absent for Staza-curated collectibles, and never visually dominant.
 */
export const CollectibleSource = (source) => {
  if (!source || !source.sourceAttribution) return "";
  const label = escapeHtml(source.sourceAttribution);
  const body = source.sourceUrl
    ? `<a href="${escapeHtml(source.sourceUrl)}" target="_blank" rel="noopener noreferrer">${label}</a>`
    : label;
  return `<p class="collectible-detail-source" data-user-content><small>Source: ${body}</small></p>`;
};

const CATEGORY_LABELS = {
  viewpoint: "Viewpoint",
  peak: "Peak",
  castle: "Castle",
  waterfall: "Waterfall",
  place: "Place",
  mountain_pass: "Mountain pass",
  landmark: "Landmark",
  coin: "Coin"
};

/** Sentence-case, localizable label for a collectible's category or type. */
export const collectibleCategoryLabel = (collectible) => {
  const key = collectible.primaryCategory ?? collectible.type ?? "";
  if (CATEGORY_LABELS[key]) return CATEGORY_LABELS[key];
  const spaced = String(key).replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

export const formatCollectibleDistance = (meters, locale) => {
  const km = meters / 1000;
  return km < 1
    ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(meters / 10) * 10)} m`
    : `${new Intl.NumberFormat(locale, { maximumFractionDigits: km < 10 ? 1 : 0 }).format(km)} km`;
};

export const CollectibleDetail = (collectible, relatedQuests = [], { distanceMeters, locale } = {}) => {
  const hasPosition = Number.isFinite(collectible.latitude) && Number.isFinite(collectible.longitude);
  return `
    <section class="world-detail collectible-detail" aria-label="Collectible detail">
      <header>
        <div>
          <h2>${CollectibleIcon(collectible.type)}<span data-user-content>${escapeHtml(collectible.name)}</span></h2>
          <p class="world-detail-meta">
            <small>${escapeHtml(collectibleCategoryLabel(collectible))}</small>
            <small>${escapeHtml(collectible.value)} XP</small>
          </p>
        </div>
        <button class="world-detail-close" type="button" data-world-close aria-label="Close collectible detail">\u00d7</button>
      </header>
      <p class="collectible-detail-state ${collectible.found ? "is-found" : "is-unfound"}">
        ${collectible.found ? "Visited" : "Unvisited"}
      </p>
      ${Number.isFinite(collectible.elevationMeters)
        ? `<p class="collectible-detail-elevation">${escapeHtml(Math.round(collectible.elevationMeters))}\u00a0m</p>`
        : ""}
      ${Number.isFinite(distanceMeters)
        ? `<p class="collectible-detail-distance"><span>Distance from home</span> <strong>${escapeHtml(formatCollectibleDistance(distanceMeters, locale))}</strong></p>`
        : ""}
      ${collectible.description ? `<p class="collectible-detail-description" data-user-content>${escapeHtml(collectible.description)}</p>` : ""}
      ${CollectibleSource(collectible.source)}
      ${relatedQuests.length ? `
        <div class="collectible-detail-quests">
          <h3>Part of</h3>
          <ul>${relatedQuests.map((quest) => `
            <li><button type="button" data-collectible-quest="${escapeHtml(quest.id)}" data-user-content>${escapeHtml(quest.title)}</button></li>
          `).join("")}</ul>
        </div>
      ` : ""}
      ${hasPosition ? `
        <button type="button" class="collectible-detail-route" data-collectible-route="${escapeHtml(collectible.id)}">Route to</button>
      ` : ""}
    </section>
  `;
};
