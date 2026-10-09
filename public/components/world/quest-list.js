import { escapeHtml } from "../collected-list.js";

const objectiveLabel = (objective) => {
  if (objective.type === "flowline_rule") {
    const qualifiers = [
      objective.minimumLengthMeters ? `at least ${Math.round(objective.minimumLengthMeters / 1000 * 10) / 10} km each` : "",
      objective.minimumAverageSpeedMps ? `at least ${Math.round(objective.minimumAverageSpeedMps * 3.6)} km/h average` : "",
      objective.sameActivity ? "in one Activity" : ""
    ].filter(Boolean);
    return `Complete ${objective.requiredCount} Flowlines${qualifiers.length ? `, ${qualifiers.join(", ")}` : ""}`;
  }
  const categoryName = ({
    peak: "peaks",
    place: "places",
    mountain_pass: "mountain passes",
    viewpoint: "viewpoints",
    castle: "castles",
    waterfall: "waterfalls"
  })[objective.category] ?? "collectibles";
  if (objective.type === "collectible_targets") {
    return `Visit ${objective.targets.map((target) => target.name).join(", ")}`;
  }
  return `Discover ${objective.requiredCount} ${categoryName}`;
};

const SuggestionCard = (suggestion, started) => `
  <li class="quest-suggestion-card">
    <article>
      <span class="quest-card-head">
        <strong data-user-content>${escapeHtml(suggestion.title)}</strong>
        <small>Level ${escapeHtml(suggestion.recommendedLevel)}</small>
      </span>
      <span class="quest-card-description" data-user-content>${escapeHtml(suggestion.description)}</span>
      <ul>${suggestion.objectives.map((objective) =>
        `<li>${escapeHtml(objectiveLabel(objective))}</li>`
      ).join("")}</ul>
      <button type="button" data-quest-start="${escapeHtml(suggestion.id)}"${started ? " disabled" : ""}>
        ${started ? "Started" : "Start quest"}
      </button>
    </article>
  </li>
`;

const InstanceCard = (instance, pendingQuestId) => {
  const objectiveStates = instance.objectives;
  const completed = objectiveStates.filter((item) => item.progress.complete).length;
  const ratio = objectiveStates.length ? completed / objectiveStates.length : 0;
  const status = instance.status === "completed" ? "Complete" : "Active";
  return `
    <li class="quest-instance-card is-${instance.status}">
      <article>
        <span class="quest-card-head">
          <strong data-user-content>${escapeHtml(instance.title)}</strong>
          <small>${status}</small>
        </span>
        <span class="quest-card-description" data-user-content>${escapeHtml(instance.description)}</span>
        <ul>${objectiveStates.map(({ objective, progress }) => `
          <li class="${progress.complete ? "is-complete" : ""}">
            <span>${escapeHtml(objectiveLabel(objective))}</span>
            <small>${escapeHtml(progress.completed)} / ${escapeHtml(progress.required)}</small>
          </li>
        `).join("")}</ul>
          ${instance.status === "active" ? `
            <button type="button" class="quest-instance-cancel" data-quest-cancel="${escapeHtml(instance.id)}"
              ${pendingQuestId === instance.id ? "disabled" : ""}>
              Cancel quest
            </button>
          ` : ""}
          <span class="quest-card-progress">
            <span class="quest-progress-track" aria-hidden="true"><i style="width: ${Math.round(ratio * 100)}%;"></i></span>
            <small>${completed} / ${objectiveStates.length} objectives</small>
        </span>
      </article>
    </li>
  `;
};

export const QuestList = (suggestions, instances, pendingQuestId) => {
  const startedIds = new Set(instances.map((instance) => instance.suggestionId));
  return `
    <section class="default-quest-list" aria-label="Suggested quests">
      <h2>Local recommendations</h2>
      ${suggestions.length
        ? `<ol>${suggestions.map((suggestion) => SuggestionCard(
          suggestion,
          startedIds.has(suggestion.id) || pendingQuestId === suggestion.id
        )).join("")}</ol>`
        : '<p class="default-quest-empty">No curated quests match this map area yet.</p>'}
    </section>
    <section class="quest-list" aria-label="Your quests">
      <h2>Your quests</h2>
      ${instances.length
        ? `<ol>${instances.map((instance) => InstanceCard(instance, pendingQuestId)).join("")}</ol>`
        : '<p class="default-quest-empty">Start a local recommendation to begin tracking a quest.</p>'}
    </section>
  `;
};
