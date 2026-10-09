import { escapeHtml } from "../collected-list.js";
import { CollectibleSwatch } from "./collectible-swatch.js";

export const INITIAL_VISIBLE_QUEST_SUGGESTIONS = 3;

const categoryNames = {
  peak: "peaks",
  place: "places",
  mountain_pass: "mountain passes",
  viewpoint: "viewpoints",
  castle: "castles",
  waterfall: "waterfalls"
};

const objectiveGroupLabel = (objective) => objective.type === "flowline_rule"
  ? "Flowlines"
  : categoryNames[objective.category] ?? "targets";

const objectiveIcon = (objective, completed = false) => {
  if (objective.type === "flowline_rule") {
    return `<b class="fartlek-swatch${completed ? " is-completed" : ""}" aria-hidden="true"></b>`;
  }
  return objective.category
    ? CollectibleSwatch({ category: objective.category, visited: completed })
    : "";
};

const objectiveRequirement = (objective) => {
  const required = objective.requiredCount;
  const targetCount = objective.targets.length;
  const verb = objective.type === "flowline_rule" ? "Complete"
    : objective.type === "collectible_targets" && objective.category === "place" ? "Visit"
      : "Discover";
  const targets = objectiveGroupLabel(objective);
  const base = `${verb} ${required} of these ${targetCount} ${targets}`;
  const qualifiers = objective.type === "flowline_rule" ? [
    objective.minimumLengthMeters
      ? `at least ${Math.round(objective.minimumLengthMeters / 1000 * 10) / 10} km each`
      : "",
    objective.minimumAverageSpeedMps
      ? `at least ${Math.round(objective.minimumAverageSpeedMps * 3.6)} km/h average each`
      : "",
    objective.sameActivity ? "in one Activity" : ""
  ].filter(Boolean) : [];
  return qualifiers.length ? `${base} — ${qualifiers.join(", ")}` : base;
};

const flowlineAverageSpeedLabel = (target) => {
  if (!Number.isFinite(target.averageSpeedMps) || target.averageSpeedMps < 0) {
    throw new Error(`Completed Flowline ${target.id} is missing a valid average speed.`);
  }
  return `${Math.round(target.averageSpeedMps * 3.6)} km/h`;
};

const suggestionObjectiveStates = (suggestion) => suggestion.objectives.map((objective) => ({
  objective,
  progress: {
    completed: 0,
    required: objective.requiredCount,
    complete: false
  },
  targetProgress: objective.targets.map((target) => ({ ...target, complete: false }))
}));

const objectiveGroup = (state, isSuggestion) => {
  const { objective, progress, targetProgress } = state;
  const completedLabel = isSuggestion
    ? `${progress.required} required · ${targetProgress.length} targets`
    : `${progress.completed}/${progress.required} complete`;
  return `
    <li class="quest-objective-group">
      <div class="quest-objective-group-head">
        <span class="quest-objective-summary">
          ${objectiveIcon(objective)}
          <strong>${escapeHtml(objectiveGroupLabel(objective))}</strong>
        </span>
        <small>${escapeHtml(completedLabel)}</small>
      </div>
      <p class="quest-objective-requirement">${escapeHtml(objectiveRequirement(objective))}</p>
      <ul class="quest-objective-targets">
        ${targetProgress.map((target) => `
          <li class="${target.complete ? "is-complete" : ""}">
            <span class="quest-objective-copy">
              ${objectiveIcon(objective, target.complete)}
              <span>${escapeHtml(target.name)}${objective.type === "flowline_rule" && target.complete
                ? ` — ${escapeHtml(flowlineAverageSpeedLabel(target))}` : ""}</span>
            </span>
            <small>${isSuggestion ? "Target" : target.complete ? "Complete" : "Not complete"}</small>
          </li>
        `).join("")}
      </ul>
    </li>
  `;
};

const questCard = ({
  key,
  title,
  description,
  objectiveStates,
  status,
  selectedQuestKey,
  pendingQuestId,
  suggestionId,
  instanceId,
  alreadyStarted
}) => {
  const isSuggestion = suggestionId !== undefined;
  const completed = objectiveStates.filter((item) => item.progress.complete).length;
  const ratio = objectiveStates.length ? completed / objectiveStates.length : 0;
  return `
    <li class="${isSuggestion ? "quest-suggestion-card" : "quest-instance-card"} quest-card is-${status}${selectedQuestKey === key ? " is-map-selected" : ""}">
      <article data-quest-card="${escapeHtml(key)}">
        <span class="quest-card-head">
          <button type="button" class="quest-card-select" data-quest-select="${escapeHtml(key)}"
            aria-pressed="${selectedQuestKey === key}" aria-label="Show targets for ${escapeHtml(title)} on map">
            <strong data-user-content>${escapeHtml(title)}</strong>
            <span aria-hidden="true">⌖</span>
          </button>
          ${isSuggestion
            ? `<button type="button" data-quest-start="${escapeHtml(suggestionId)}"${alreadyStarted ? " disabled" : ""}>
                ${alreadyStarted ? "Started" : "Start quest"}
              </button>`
            : status === "active" ? `
              <button type="button" class="quest-instance-cancel" data-quest-cancel="${escapeHtml(instanceId)}"
                aria-label="Cancel quest" title="Cancel quest"
                ${pendingQuestId === instanceId ? "disabled" : ""}>\u2715</button>
            ` : "<small>Complete</small>"}
        </span>
        <span class="quest-card-description" data-user-content>${escapeHtml(description)}</span>
        <ul class="quest-objective-groups">
          ${objectiveStates.map((state) => objectiveGroup(state, isSuggestion)).join("")}
        </ul>
        ${isSuggestion ? "" : `
          <span class="quest-card-progress">
            <span class="quest-progress-track" aria-hidden="true"><i style="width: ${Math.round(ratio * 100)}%;"></i></span>
            <small>${completed} / ${objectiveStates.length} objectives</small>
          </span>
        `}
      </article>
    </li>
  `;
};

const SuggestionCard = (suggestion, started, selectedQuestKey) => questCard({
  key: `suggestion:${suggestion.id}`,
  title: suggestion.title,
  description: suggestion.description,
  objectiveStates: suggestionObjectiveStates(suggestion),
  status: "suggested",
  selectedQuestKey,
  suggestionId: suggestion.id,
  alreadyStarted: started
});

const InstanceCard = (instance, pendingQuestId, selectedQuestKey) => questCard({
  key: `instance:${instance.id}`,
  title: instance.title,
  description: instance.description,
  objectiveStates: instance.objectives,
  status: instance.status,
  selectedQuestKey,
  pendingQuestId,
  instanceId: instance.id
});

export const QuestList = (suggestions, instances, pendingQuestId, showAllSuggestions = false, selectedQuestKey) => {
  const startedIds = new Set(instances.map((instance) => instance.suggestionId));
  const visibleSuggestions = showAllSuggestions
    ? suggestions
    : suggestions.slice(0, INITIAL_VISIBLE_QUEST_SUGGESTIONS);
  const hasHiddenSuggestions = suggestions.length > INITIAL_VISIBLE_QUEST_SUGGESTIONS;
  return `
    <section class="default-quest-list" aria-label="Suggested quests">
      <h2>Local recommendations</h2>
      <p class="quest-section-description">
        Optional challenges for exploring places and completing Flowlines. Select a quest to see its targets on the map.
      </p>
      ${suggestions.length
        ? `<ol id="quest-recommendations">${visibleSuggestions.map((suggestion) => SuggestionCard(
          suggestion,
          startedIds.has(suggestion.id) || pendingQuestId === suggestion.id,
          selectedQuestKey
        )).join("")}</ol>
          ${hasHiddenSuggestions ? `
            <button type="button" class="quest-suggestions-toggle" data-quest-suggestions-toggle
              aria-controls="quest-recommendations" aria-expanded="${showAllSuggestions}">
              ${showAllSuggestions ? "Show fewer" : `Show all ${suggestions.length} quests`}
            </button>
          ` : ""}`
        : '<p class="default-quest-empty">No curated quests match this map area yet.</p>'}
    </section>
    <section class="quest-list" aria-label="Your running quests">
      <h2>Your running Quests</h2>
      ${instances.length
        ? `<ol>${instances.map((instance) => InstanceCard(instance, pendingQuestId, selectedQuestKey)).join("")}</ol>`
        : '<p class="default-quest-empty">Start a local recommendation to begin tracking a quest.</p>'}
    </section>
  `;
};
