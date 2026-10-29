import { escapeHtml } from "../collected-list.js";
import { CollectibleSwatch } from "../world/collectible-swatch.js";

/** Per-row collection state shared by the World quest panel and the ActivityDetail overlay. */
export const collectionStateLabel = (state) => {
  if (state === "completed") return "Completed";
  if (state === "nearby-miss") return "Nearby miss";
  return "Unvisited";
};

export const collectionProgressPercent = ({ collected = 0, total = 0 } = {}) =>
  total === 0 ? "0%" : `${Math.round((collected / total) * 100)}%`;

export const collectionProgressLabel = ({ collected = 0, total = 0 } = {}, noun = "completed") =>
  total === 0 ? "No collectibles yet" : `${collected} / ${total} ${noun}`;

/**
 * One collectible row. `interactive` rows render a `data-world-marker` button so the World map
 * can focus the marker; non-interactive rows (the replay overlay) render static content that is
 * updated in place by `data-collection-row` id as the replay plays.
 */
export const CollectionRow = ({ id, name, state = "unvisited", interactive = false }) => {
  const completed = state === "completed";
  const inner = `
    ${CollectibleSwatch({ visited: completed })}
    <span class="quest-collectible-name" data-user-content>${escapeHtml(name)}</span>
    <span class="quest-collectible-state">${collectionStateLabel(state)}</span>
  `;
  const body = interactive
    ? `<button type="button" data-world-marker="${escapeHtml(id)}">${inner}</button>`
    : `<div class="quest-collectible-row">${inner}</div>`;
  return `<li class="quest-collectible${completed ? " is-found" : ""}" data-collection-row="${escapeHtml(id)}">${body}</li>`;
};

/**
 * The reusable collection box used by both the World quest detail and the ActivityDetail replay
 * overlay: a header (optional "by" creator attribution and extra meta), optional description, a
 * "completed" progress bar, and a collectible row list. `footer` carries caller-specific extras
 * (external route CTA, owner actions). `closable` renders the World-style X.
 */
export const CollectionPanel = ({
  title,
  creator,
  description,
  progress = { collected: 0, total: 0 },
  closable = false,
  rows = [],
  ariaLabel = "Collection detail",
  metaLeading = "",
  metaTrailing = "",
  footer = "",
  emptyMessage = "No collectibles yet.",
  progressNoun = "completed"
}) => {
  const percent = collectionProgressPercent(progress);
  return `
    <section class="world-detail collection-panel" aria-label="${escapeHtml(ariaLabel)}">
      <header>
        <div>
          <h2 data-user-content>${escapeHtml(title ?? "")}</h2>
          <p class="world-detail-meta">
            ${metaLeading}
            ${creator ? `<small data-user-content>by ${escapeHtml(creator)}</small>` : ""}
            ${metaTrailing}
          </p>
        </div>
        ${closable ? '<button class="world-detail-close" type="button" data-world-close aria-label="Close">\u00d7</button>' : ""}
      </header>
      ${description ? `<p class="quest-detail-description" data-user-content>${escapeHtml(description)}</p>` : ""}
      <p class="quest-detail-progress">
        <span class="quest-progress-track" aria-hidden="true">
          <i style="width: ${escapeHtml(percent)};" data-collection-progress-bar></i>
        </span>
        <strong data-collection-progress-label>${escapeHtml(collectionProgressLabel(progress, progressNoun))}</strong>
        <small data-collection-progress-percent>${escapeHtml(percent)}</small>
      </p>
      ${rows.length
        ? `<ol class="quest-collectibles">${rows.map(CollectionRow).join("")}</ol>`
        : `<p class="world-detail-empty">${escapeHtml(emptyMessage)}</p>`}
      ${footer}
    </section>
  `;
};
