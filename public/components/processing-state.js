export const processingSteps = [
  "Reading GPS route",
  "Matching collectibles",
  "Calculating XP",
  "Building replay"
];

export const ProcessingState = ({ step = 0 }) => `
  <header class="add-activity-header">
    <div><h1 id="add-activity-title">Add Activity</h1><p>Import a FIT or GPX file to start discovering</p></div>
  </header>
  <section class="processing-state" aria-labelledby="processing-title" aria-live="polite">
    <div class="processing-activity-icon" aria-hidden="true"><img src="/assets/add-activity-processing.svg" width="20" height="20" alt=""></div>
    <div>
      <h2 id="processing-title">Processing Activity</h2>
      <p>Discovering collectibles along your route</p>
    </div>
    <ol class="processing-steps">
      ${processingSteps.map((label, index) => {
        const status = index < step ? "complete" : index === step ? "active" : "pending";
        return `<li class="is-${status}"${index === step ? ' aria-current="step"' : ""}>
          <span class="processing-step-icon">${status === "complete" ? '<img src="/assets/add-activity-processing-check.svg" width="10" height="10" alt="">' : ""}</span>
          <span>${label}</span>
        </li>`;
      }).join("")}
    </ol>
  </section>
`;
