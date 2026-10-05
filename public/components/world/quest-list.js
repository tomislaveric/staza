import { escapeHtml } from "../collected-list.js";

export const formatProgressPercent = (progress) => {
  if (!progress || progress.total === 0) return "0%";
  return `${Math.round(progress.ratio * 100)}%`;
};

export const questProgressLabel = (progress) => {
  if (!progress || progress.total === 0) return "No collectibles yet";
  return `${progress.collected} / ${progress.total} completed`;
};

export const QuestStatusBadge = (quest) => {
  if (quest.status === "draft") return '<span class="quest-badge is-draft">Draft</span>';
  if (quest.progress?.complete) return '<span class="quest-badge is-complete">Complete</span>';
  return "";
};

export const QuestCard = (quest, selectedQuestId) => `
  <li>
    <button class="quest-card${quest.id === selectedQuestId ? " is-selected" : ""}" type="button"
      data-quest-card="${escapeHtml(quest.id)}" aria-pressed="${quest.id === selectedQuestId}">
      <span class="quest-card-head">
        <strong data-user-content>${escapeHtml(quest.title)}</strong>
        ${QuestStatusBadge(quest)}
      </span>
      ${quest.description ? `<span class="quest-card-description" data-user-content>${escapeHtml(quest.description)}</span>` : ""}
      <span class="quest-card-progress">
        <span class="quest-progress-track" aria-hidden="true">
          <i style="width: ${escapeHtml(formatProgressPercent(quest.progress))};"></i>
        </span>
        <small>${escapeHtml(questProgressLabel(quest.progress))} \u00b7 ${escapeHtml(formatProgressPercent(quest.progress))}</small>
      </span>
      <span class="quest-card-meta">
        <small>${escapeHtml(quest.collectibleCount)} collectibles</small>
        ${quest.hasRoute ? "<small>Route</small>" : ""}
      </span>
    </button>
  </li>
`;

export const QuestList = (quests, selectedQuestId) => {
  if (!quests.length) {
    return `
      <section class="quest-list quest-list-empty" aria-label="Quests nearby">
        <h2>Quests nearby</h2>
        <p>Nothing curated here yet.</p>
        <span>Pan or zoom the map to look somewhere else.</span>
      </section>
    `;
  }
  return `
    <section class="quest-list" aria-label="Quests nearby">
      <h2>Quests nearby</h2>
      <ol>${quests.map((quest) => QuestCard(quest, selectedQuestId)).join("")}</ol>
    </section>
  `;
};
