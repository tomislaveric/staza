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

export const CollectibleDetail = (collectible, relatedQuests = []) => {
  return `
    <section class="world-detail collectible-detail" aria-label="Collectible detail">
      <header>
        <div>
          <h2>${CollectibleIcon(collectible.type)}<span data-user-content>${escapeHtml(collectible.name)}</span></h2>
          <p class="world-detail-meta" data-user-content>
            <small>${escapeHtml(collectible.primaryCategory ?? collectible.type)}</small>
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
      ${collectible.description ? `<p class="collectible-detail-description" data-user-content>${escapeHtml(collectible.description)}</p>` : ""}
      ${CollectibleSource(collectible.source)}
      ${relatedQuests.length ? `
        <div class="collectible-detail-quests">
          <h3>Part of</h3>
          <ul>${relatedQuests.map((quest) => `
            <li><button type="button" data-quest-card="${escapeHtml(quest.id)}" data-user-content>${escapeHtml(quest.title)}</button></li>
          `).join("")}</ul>
        </div>
      ` : ""}
    </section>
  `;
};
