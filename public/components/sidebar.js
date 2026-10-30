import { appPath } from "../app-locales.js";

export const navItems = [
  ["home", "Home", "nav-home.svg"],
  ["activities", "Activities", "nav-activities.svg"],
  ["world", "World", "nav-world.svg"],
  ["skill-tree", "Skill Atlas", "nav-skill-tree.svg"],
  ["progress", "Progress", "nav-progress.svg"],
  ["profile", "Profile", "nav-profile.svg"],
];

export const SidebarLogo = (locale = "en") => `
  <a class="sidebar-logo" href="${appPath("home")}" aria-label="Staza home">
    <img src="/assets/logo-full.svg" alt="">
  </a>
`;

export const NavItem = ([screen, label, icon]) => `
  <button class="sidebar-nav-item${screen === "home" ? " is-active" : ""}" type="button" data-screen="${screen}"${screen === "home" ? ' aria-current="page"' : ""}>
    <img src="/assets/${icon}" width="18" height="18" alt="">
    <span>${label}</span>
  </button>
`;

export const SidebarNavMenu = () => `
  <nav class="sidebar-nav-menu" aria-label="Primary navigation">
    ${navItems.map(NavItem).join("")}
  </nav>
`;

export const AddActivityCTA = () => `
  <button class="add-activity-cta" type="button" data-screen="add-activity">
    <img src="/assets/add-activity-upload.svg" width="16" height="16" alt="">
    <span>ADD ACTIVITY</span>
  </button>
`;

export const Sidebar = (locale = "en") => `
  <aside class="sidebar">
    <div class="sidebar-logo-region">${SidebarLogo(locale)}</div>
    ${SidebarNavMenu()}
    <div class="sidebar-cta-region">${AddActivityCTA()}</div>
  </aside>
`;

export const mobilePrimaryScreens = ["home", "world", "skill-tree", "progress"];
export const mobileSecondaryScreens = ["activities", "profile"];

const navItem = (screen) => navItems.find(([itemScreen]) => itemScreen === screen);

/** Navigation destination highlighted for a screen; Activity detail belongs to Activities. */
export const navScreenFor = (screen) => (screen === "activity-detail" ? "activities" : screen);

export const MobileHeader = (locale = "en") => `
  <header class="mobile-header">
    <a class="mobile-header-logo" href="${appPath("home")}" aria-label="Staza home">
      <img src="/assets/logo-full.svg" height="28" alt="">
    </a>
    <button class="mobile-add-activity" type="button" data-screen="add-activity" aria-label="Add Activity">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 11V2m0 0L4.5 5.5M8 2l3.5 3.5M3 10.5v3h10v-3"/></svg>
      <span>ADD ACTIVITY</span>
    </button>
  </header>
`;

const MobileNavItem = ([screen, label, icon]) => `
  <button class="mobile-nav-item${screen === "home" ? " is-active" : ""}" type="button" data-screen="${screen}"${screen === "home" ? ' aria-current="page"' : ""}>
    <img src="/assets/${icon}" width="20" height="20" alt="">
    <span>${label}</span>
  </button>
`;

export const MobileNavigation = (locale = "en") => `
  <div class="mobile-navigation">
    <div class="mobile-more-menu" id="mobile-more-menu" data-mobile-more-menu hidden>
      <nav aria-label="More destinations">
        ${mobileSecondaryScreens.map(navItem).map(([screen, label, icon]) => `
          <button class="mobile-more-item" type="button" data-screen="${screen}">
            <img src="/assets/${icon}" width="18" height="18" alt="">
            <span>${label}</span>
          </button>
        `).join("")}
      </nav>
    </div>
    <nav class="mobile-nav-menu" aria-label="Primary navigation">
      ${mobilePrimaryScreens.map(navItem).map(MobileNavItem).join("")}
      <button class="mobile-nav-item mobile-nav-more" type="button" data-mobile-more
        aria-haspopup="true" aria-expanded="false" aria-controls="mobile-more-menu">
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="10" r="1.6"/><circle cx="10" cy="10" r="1.6"/><circle cx="16" cy="10" r="1.6"/></svg>
        <span>More</span>
      </button>
    </nav>
  </div>
`;

export const setMobileMoreOpen = (mountPoint, open) => {
  const menu = mountPoint.querySelector("[data-mobile-more-menu]");
  const toggle = mountPoint.querySelector("[data-mobile-more]");
  if (!menu || !toggle) return;
  menu.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
  toggle.classList.toggle("is-open", open);
};

export const sidebar = Sidebar;

const setCurrent = (item, isActive) => {
  item.classList.toggle("is-active", isActive);
  if (isActive) item.setAttribute("aria-current", "page");
  else item.removeAttribute("aria-current");
};

export const setSidebarScreen = (mountPoint, screen) => {
  const navScreen = navScreenFor(screen);
  for (const item of mountPoint.querySelectorAll(".sidebar-nav-item, .mobile-nav-item[data-screen], .mobile-more-item")) {
    setCurrent(item, item.dataset.screen === navScreen);
  }
  const more = mountPoint.querySelector("[data-mobile-more]");
  if (more) setCurrent(more, mobileSecondaryScreens.includes(navScreen));
  for (const item of mountPoint.querySelectorAll(".add-activity-cta, .mobile-add-activity")) {
    item.classList.toggle("is-current", screen === "add-activity");
  }
  setMobileMoreOpen(mountPoint, false);
};
