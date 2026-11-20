import { escapeHtml } from "../collected-list.js";
import { characterScoreLabels, FlowlineFacts, flowlineCharacter } from "./explore-reveal.js";

export const formatDistance = (meters) => `${(meters / 1000).toFixed(meters >= 10_000 ? 0 : 1)} km`;

/** mm:ss under an hour, h:mm:ss beyond. Matches the plain, non-arcade Staza tone. */
export const formatElapsed = (seconds) => {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const secs = total % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
};

export const formatSpeed = (metersPerSecond) => `${(metersPerSecond * 3.6).toFixed(1)} km/h`;

/**
 * Selecting a Flowline shows its primary character first: name, length, one character score and
 * road quality, and whether it is still unridden. Completion stats stay behind "View details".
 * Wording never implies a speed target - completion is about finishing the segment, not pace.
 */
export const FartlekDetail = (fartlek, { inRoute = false } = {}) => {
  const { latestCompletion } = fartlek;
  const { tags } = flowlineCharacter(fartlek);
  return `
    <section class="world-detail fartlek-detail" aria-label="Flowline detail">
      <header>
        <div>
          <h2><span data-user-content>${escapeHtml(fartlek.name)}</span></h2>
          <p class="fartlek-detail-state ${fartlek.completed ? "is-completed" : "is-uncompleted"}">
            ${fartlek.completed ? "Completed" : "Unridden"}
          </p>
        </div>
        <button class="world-detail-close" type="button" data-world-close aria-label="Close Flowline detail">\u00d7</button>
      </header>
      ${FlowlineFacts(fartlek)}
      ${tags.length > 1 ? `
        <p class="flowline-best-for"><span>Best for</span>
          ${tags.map((tag) => `<span class="flowline-character is-${tag}">${escapeHtml(characterScoreLabels[tag])}</span>`).join("")}
        </p>` : ""}
      <div class="fartlek-detail-actions">
        <button type="button" class="collectible-route-button" data-flowline-add-route="${escapeHtml(fartlek.id)}" aria-pressed="${inRoute}">${inRoute ? "Added to route" : "Add to route"}</button>
      </div>
      <details class="fartlek-detail-more">
        <summary>View details</summary>
        ${fartlek.completed ? `
          <dl class="fartlek-detail-stats">
            <div><dt>Latest time</dt><dd>${escapeHtml(formatElapsed(latestCompletion.elapsedTimeS))}</dd></div>
            <div><dt>Average speed</dt><dd>${escapeHtml(formatSpeed(latestCompletion.averageSpeedMps))}</dd></div>
            ${fartlek.bestElapsedTimeS !== undefined
              ? `<div><dt>Best time</dt><dd>${escapeHtml(formatElapsed(fartlek.bestElapsedTimeS))}</dd></div>`
              : ""}
            <div><dt>Completions</dt><dd>${escapeHtml(fartlek.completionCount)}</dd></div>
          </dl>
        ` : `<p class="fartlek-detail-hint">Complete the full segment in one activity.</p>`}
      </details>
    </section>
  `;
};
