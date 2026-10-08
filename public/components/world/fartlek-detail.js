import { escapeHtml } from "../collected-list.js";

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

const formatCoordinate = ([longitude, latitude]) => `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;

/** Start/finish described by coordinates only; Fartleks have no place names of their own. */
const startFinish = (geometry) => {
  const { coordinates } = geometry;
  return `${formatCoordinate(coordinates[0])} \u2192 ${formatCoordinate(coordinates[coordinates.length - 1])}`;
};

/**
 * Selecting a Fartlek shows its traversal challenge: name, start/finish, length, and
 * completion status. Wording never implies a speed target - completion is about finishing
 * the segment, not about pace.
 */
export const FartlekDetail = (fartlek) => {
  const { latestCompletion } = fartlek;
  return `
    <section class="world-detail fartlek-detail" aria-label="Flowline detail">
      <header>
        <div>
          <h2><span data-user-content>${escapeHtml(fartlek.name)}</span></h2>
          <p class="world-detail-meta" data-user-content>
            <small>${escapeHtml(startFinish(fartlek.geometry))}</small>
            <small>${escapeHtml(formatDistance(fartlek.lengthMeters))}</small>
          </p>
        </div>
        <button class="world-detail-close" type="button" data-world-close aria-label="Close Flowline detail">\u00d7</button>
      </header>
      <p class="fartlek-detail-state ${fartlek.completed ? "is-completed" : "is-uncompleted"}">
        ${fartlek.completed ? "Completed" : "Not yet completed"}
      </p>
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
    </section>
  `;
};
