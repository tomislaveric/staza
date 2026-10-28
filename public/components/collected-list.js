export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

export const collectedEvents = (activity) => Array.isArray(activity.events)
  ? activity.events.filter((event) => event.type === "collectible_collected")
  : [];

export const CollectibleIcon = (type) => {
  const asset = type === "landmark" ? "collectible-landmark.svg" : "collectible-coin.svg";
  return `<span class="collectible-type-icon collectible-type-${escapeHtml(type)}" aria-hidden="true"><img src="/assets/${asset}" width="16" height="16" alt=""></span>`;
};

export const CollectibleCard = (event) => {
  const collectible = event.collectible ?? {};
  return `
    <li class="collectible-card">
      ${CollectibleIcon(collectible.type)}
      <div class="collectible-card-details">
        <strong data-user-content>${escapeHtml(collectible.name ?? event.sourceId)}</strong>
        <span data-user-content>${escapeHtml(collectible.type ?? "collectible")}</span>
      </div>
      <strong class="collectible-value">${event.repeat ? "Revisited · no XP" : `+${escapeHtml(event.value)} XP`}</strong>
    </li>
  `;
};

export const CollectedList = (activity) => {
  const events = collectedEvents(activity);
  if (!events.length) {
    return `
      <section class="collected-empty-state" aria-label="Collected items">
        <p>NO COLLECTIBLES FOUND</p>
        <span>No collectible events were recorded on this activity.</span>
      </section>
    `;
  }
  return `<ol class="collected-list" aria-label="Collected items">${events.map(CollectibleCard).join("")}</ol>`;
};
