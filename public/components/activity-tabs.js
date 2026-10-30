const SHOW_ACTIVITY_TABS = false;

export const ActivityTabs = (activity, selectedTab = "replay") => `
  <div class="activity-tabs" role="tablist" aria-label="Activity detail sections" ${SHOW_ACTIVITY_TABS ? "" : "hidden"}>
    <button class="${selectedTab === "replay" ? "is-active" : ""}" type="button" role="tab" aria-selected="${selectedTab === "replay"}" data-activity-tab="replay">REPLAY</button>
    <button class="${selectedTab === "video" ? "is-active" : ""}" type="button" role="tab" aria-selected="${selectedTab === "video"}" data-activity-tab="video">VIDEO</button>
  </div>
`;
