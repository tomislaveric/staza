import { escapeHtml } from "../collected-list.js";
import { CollectibleSwatch } from "./collectible-swatch.js";

export const INITIAL_VISIBLE_QUEST_SUGGESTIONS = 3;

const objectiveGroupLabel = (objective) => {
  if (objective.type === "flowline_rule") {
    const qualifiers = [
      objective.minimumLengthMeters ? `at least ${Math.round(objective.minimumLengthMeters / 1000 * 10) / 10} km each` : "",
      objective.minimumAverageSpeedMps ? `at least ${Math.round(objective.minimumAverageSpeedMps * 3.6)} km/h average` : "",
      objective.sameActivity ? "in one Activity" : ""
    ].filter(Boolean);
    return `Flowlines${qualifiers.length ? ` · ${qualifiers.join(", ")}` : ""}`;
  }
  const categoryName = ({
    peak: "peaks",
    place: "places",
    mountain_pass: "mountain passes",
    viewpoint: "viewpoints",
    castle: "castles",
    waterfall: "waterfalls"
  })[objective.category] ?? "targets";
  return categoryName;
};

const objectiveTypeLabel = (objective) => {
  if (objective.type === "flowline_rule") return "Flowline";
  return ({
    peak: "Mountain peak",
    place: "Place",
    mountain_pass: "Mountain pass",
    viewpoint: "Viewpoint",
    castle: "Castle",
    waterfall: "Waterfall"
  })[objective.category] ?? "Collectible";
};

const objectiveIcon = (objective) => {
  if (objective.type === "flowline_rule") {
    return '<b class="fartlek-swatch" aria-hidden="true"></b>';
  }
  return objective.category ? CollectibleSwatch({ category: objective.category }) : "";
};

const flowlineAverageSpeedLabel = (target) => {
  if (!Number.isFinite(target.averageSpeedMps) || target.averageSpeedMps < 0) {
    throw new Error(`Completed Flowline ${target.id} is missing a valid average speed.`);
  }
  return `${Math.round(target.averageSpeedMps * 3.6)} km/h`;
};

const activeFlowlineGroup = ({ progress, targetProgress }) => `
  <li class="quest-objective-group">
    <div class="quest-objective-group-head">
      <span class="quest-objective-summary">
        <b class="fartlek-swatch" aria-hidden="true"></b>
        <strong>Flowlines completed</strong>
      </span>
      <small>${escapeHtml(progress.completed)}/${escapeHtml(progress.required)}</small>
    </div>
    <ul class="quest-objective-targets">
      ${targetProgress.filter((target) => target.complete).map((target) => `
        <li class="is-complete is-flowline-completion">
          <span class="quest-objective-copy">
            <b class="fartlek-swatch is-completed" aria-hidden="true"></b>
            <span>${escapeHtml(target.name)} - ${escapeHtml(flowlineAverageSpeedLabel(target))}</span>
          </span>
        </li>
      `).join("")}
    </ul>
  </li>
`;

const objectiveGroup = ({ objective, progress, targetProgress }) => `
  <li class="quest-objective-group">
    <div class="quest-objective-group-head">
      <strong>${escapeHtml(objectiveGroupLabel(objective))}</strong>
      <small>${escapeHtml(progress.completed)} / ${escapeHtml(progress.required)} required</small>
    </div>
    <ul class="quest-objective-targets">
      ${targetProgress.map((target) => `
        <li class="${target.complete ? "is-complete" : ""}">
          <span class="quest-objective-copy">
            ${objectiveIcon(objective)}
            <span>${escapeHtml(target.name)}</span>
          </span>
          <small>${target.complete ? "Complete" : "Not complete"}</small>
        </li>
      `).join("")}
    </ul>
  </li>
`;

const SuggestionCard = (suggestion, started) => `
  <li class="quest-suggestion-card">
    <article>
      <span class="quest-card-head">
        <strong data-user-content>${escapeHtml(suggestion.title)}</strong>
      </span>
      <span class="quest-card-description" data-user-content>${escapeHtml(suggestion.description)}</span>
      <ul class="quest-suggestion-goals" aria-label="Quest goals">
        ${suggestion.objectives.map((objective) => `
          <li class="quest-suggestion-goal">
            ${objectiveIcon(objective)}
            <span>${escapeHtml(objectiveTypeLabel(objective))}</span>
          </li>
        `).join("")}
      </ul>
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
  const renderObjectiveGroup = (state) => instance.status === "active"
    && state.objective.type === "flowline_rule"
    ? activeFlowlineGroup(state)
    : objectiveGroup(state);
  return `
    <li class="quest-instance-card is-${instance.status}">
      <article>
        <span class="quest-card-head">
          <strong data-user-content>${escapeHtml(instance.title)}</strong>
          ${instance.status === "active" ? `
            <button type="button" class="quest-instance-cancel" data-quest-cancel="${escapeHtml(instance.id)}"
              aria-label="Cancel quest" title="Cancel quest"
              ${pendingQuestId === instance.id ? "disabled" : ""}>\u2715</button>
          ` : "<small>Complete</small>"}
        </span>
        <span class="quest-card-description" data-user-content>${escapeHtml(instance.description)}</span>
        <ul class="quest-objective-groups">${objectiveStates.map((state) => renderObjectiveGroup(state)).join("")}</ul>
        <span class="quest-card-progress">
          <span class="quest-progress-track" aria-hidden="true"><i style="width: ${Math.round(ratio * 100)}%;"></i></span>
          <small>${completed} / ${objectiveStates.length} objectives</small>
        </span>
      </article>
    </li>
  `;
};

export const QuestList = (suggestions, instances, pendingQuestId, showAllSuggestions = false) => {
  const startedIds = new Set(instances.map((instance) => instance.suggestionId));
  const visibleSuggestions = showAllSuggestions
    ? suggestions
    : suggestions.slice(0, INITIAL_VISIBLE_QUEST_SUGGESTIONS);
  const hasHiddenSuggestions = suggestions.length > INITIAL_VISIBLE_QUEST_SUGGESTIONS;
  return `
    <section class="default-quest-list" aria-label="Suggested quests">
      <h2>Local recommendations</h2>
      <p class="quest-section-description">
        Optional challenges for exploring places and completing Flowlines. Start one to track your progress.
      </p>
      ${suggestions.length
        ? `<ol id="quest-recommendations">${visibleSuggestions.map((suggestion) => SuggestionCard(
          suggestion,
          startedIds.has(suggestion.id) || pendingQuestId === suggestion.id
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
        ? `<ol>${instances.map((instance) => InstanceCard(instance, pendingQuestId)).join("")}</ol>`
        : '<p class="default-quest-empty">Start a local recommendation to begin tracking a quest.</p>'}
    </section>
  `;
};
