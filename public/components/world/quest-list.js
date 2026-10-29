import { escapeHtml } from "../collected-list.js";
import { CollectibleSwatch } from "./collectible-swatch.js";
import { plannedRouteGpxUrl, plannedRouteSummary } from "./exploration-panel.js";

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
  const base = objective.type === "collectible_targets" && required === targetCount
    ? `${verb} all ${targetCount} ${targets}`
    : `${verb} ${required} of these ${targetCount} ${targets}`;
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

const objectiveGroup = (state, isCompletedQuest) => {
  const { objective, progress, targetProgress } = state;
  const completedLabel = `${progress.completed}/${progress.required} complete`;
  return `
    <li class="quest-objective-group">
      <p class="quest-objective-requirement">${escapeHtml(objectiveRequirement(objective))}</p>
      <div class="quest-objective-group-head">
        <span class="quest-objective-summary">
          ${objectiveIcon(objective)}
          <strong>${escapeHtml(objectiveGroupLabel(objective))}</strong>
        </span>
        <small>${escapeHtml(completedLabel)}</small>
      </div>
      <ul class="quest-objective-targets">
        ${targetProgress.map((target) => `
          <li class="${target.complete ? "is-complete" : ""}">
            <span class="quest-objective-copy">
              ${objectiveIcon(objective, target.complete)}
              <span>${escapeHtml(target.name)}${objective.type === "flowline_rule" && target.complete
                ? ` — ${escapeHtml(flowlineAverageSpeedLabel(target))}` : ""}</span>
            </span>
            ${isCompletedQuest && !target.complete
              ? ""
              : `<small>${target.complete ? "Complete" : "Not complete"}</small>`}
          </li>
        `).join("")}
      </ul>
    </li>
  `;
};

const difficultyName = (difficulty) => (difficulty ? difficulty.charAt(0).toUpperCase() + difficulty.slice(1) : "");

const InstanceCard = (instance, pendingQuestId, selectedQuestKey, plannedRoute) => {
  const key = `instance:${instance.id}`;
  const { title, description, status } = instance;
  const objectiveStates = instance.objectives;
  // Objective copy counts targets ("Visit 2 places"), so progress counts targets too.
  const byTarget = objectiveStates.length > 0 && objectiveStates.every((item) => item.objective.type !== "flowline_rule");
  const completed = byTarget
    ? objectiveStates.reduce((sum, item) => sum + Math.min(item.progress.completed, item.progress.required), 0)
    : objectiveStates.filter((item) => item.progress.complete).length;
  const total = byTarget
    ? objectiveStates.reduce((sum, item) => sum + item.progress.required, 0)
    : objectiveStates.length;
  const ratio = total ? completed / total : 0;
  return `
    <li class="quest-instance-card quest-card is-${status}${selectedQuestKey === key ? " is-map-selected" : ""}">
      <article data-quest-card="${escapeHtml(key)}">
        <span class="quest-card-head">
          <button type="button" class="quest-card-select" data-quest-select="${escapeHtml(key)}"
            aria-pressed="${selectedQuestKey === key}" aria-label="Show targets for ${escapeHtml(title)} on map">
            <strong data-user-content>${escapeHtml(title)}</strong>
            <span aria-hidden="true">⌖</span>
          </button>
          ${status === "active" ? `
            <button type="button" class="quest-instance-cancel" data-quest-cancel="${escapeHtml(instance.id)}"
              aria-label="Cancel exploration" title="Cancel exploration"
              ${pendingQuestId === instance.id ? "disabled" : ""}>\u2715</button>
          ` : status === "failed" ? `
            <button type="button" class="quest-instance-retry" data-quest-retry="${escapeHtml(instance.id)}"
              ${pendingQuestId === instance.id ? "disabled" : ""}>Retry</button>
          ` : "<small>Complete</small>"}
        </span>
        <span class="quest-card-description" data-user-content>${escapeHtml(description)}</span>
        ${instance.rewardXp ? `<span class="quest-card-reward"><small>${difficultyName(instance.difficulty)}</small> · +${instance.rewardXp} XP${status === "active" ? " · your next activity decides" : status === "failed" ? " · not completed" : ""}</span>` : ""}
        ${plannedRoute ? `<span class="quest-card-route"><small>Planned route</small> ${escapeHtml(plannedRouteSummary(plannedRoute))}</span>` : ""}
        ${plannedRoute ? `<a class="quest-card-gpx" href="${escapeHtml(plannedRouteGpxUrl(instance.id))}" download>Download GPX</a>` : ""}
        <ul class="quest-objective-groups">
          ${objectiveStates.map((state) => objectiveGroup(state, status === "completed")).join("")}
        </ul>
        <span class="quest-card-progress">
          <span class="quest-progress-track" aria-hidden="true"><i style="width: ${Math.round(ratio * 100)}%;"></i></span>
          <small>${completed} / ${total} ${byTarget ? (total === 1 ? "target" : "targets") : "objectives"}</small>
        </span>
      </article>
    </li>
  `;
};

/** The player's started Explorations (and quests started before Explore this Area) with progress. */
export const QuestList = (instances, pendingQuestId, selectedQuestKey, plannedRoutes = new Map()) => `
  <section class="quest-list" aria-label="Your explorations">
    <h2>Your Explorations</h2>
    ${instances.length
      ? `<ol>${instances.map((instance) => InstanceCard(
        instance,
        pendingQuestId,
        selectedQuestKey,
        plannedRoutes.get(instance.id)
      )).join("")}</ol>`
      : '<p class="default-quest-empty">Use Explore this Area on the map to pick targets, plan a route and start an exploration.</p>'}
  </section>
`;
