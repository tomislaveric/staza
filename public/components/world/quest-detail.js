import { canonicalRarity, escapeHtml } from "../collected-list.js";
import { CollectionPanel, CollectionRow } from "../shared/collection-panel.js";

const formatDistance = (meters) => meters === undefined || meters === null
  ? undefined
  : `${(meters / 1000).toFixed(1)} km`;

export const CreateRouteCta = () => `
    <button type="button" class="quest-route-cta" data-coming-soon aria-haspopup="true">
      CREATE ROUTE<small>Coming soon</small>
    </button>
  `;

export const QuestCollectibleRow = (collectible) => CollectionRow({
  id: collectible.id,
  name: collectible.name,
  rarity: canonicalRarity(collectible.rarity),
  state: collectible.found ? "completed" : "unvisited",
  interactive: true
});

export const QuestDetail = (quest) => {
  const routeDistance = formatDistance(quest.route?.distanceMeters);
  const metaLeading = quest.status === "draft" ? '<span class="quest-badge is-draft">Draft</span>' : "";
  const metaTrailing = routeDistance ? `<small>${escapeHtml(routeDistance)}</small>` : "";
  const ownerActions = quest.isOwner ? `
    <div class="quest-detail-owner-actions">
      <button type="button" data-quest-edit="${escapeHtml(quest.id)}">EDIT</button>
      <button type="button" data-quest-status="${escapeHtml(quest.id)}">
        ${quest.status === "published" ? "UNPUBLISH" : "PUBLISH"}
      </button>
      <button type="button" class="quest-delete-button" data-quest-delete="${escapeHtml(quest.id)}">DELETE</button>
    </div>
  ` : "";
  return CollectionPanel({
    title: quest.title,
    creator: quest.createdBy,
    description: quest.description,
    progress: quest.progress,
    closable: true,
    ariaLabel: "Quest detail",
    metaLeading,
    metaTrailing,
    emptyMessage: "This quest has no collectibles yet.",
    rows: quest.collectibles.map((collectible) => ({
      id: collectible.id,
      name: collectible.name,
      rarity: canonicalRarity(collectible.rarity),
      state: collectible.found ? "completed" : "unvisited",
      interactive: true
    })),
    footer: `${CreateRouteCta()}${ownerActions}`
  });
};
