import { appPath } from "../app-locales.js";

export const navItems = [
  ["home", "Home", "nav-home.svg"],
  ["activities", "Activities", "nav-activities.svg"],
  ["world", "World", "nav-world.svg"],
  ["progress", "Progress", "nav-progress.svg"],
  ["profile", "Profile", "nav-profile.svg"],
];

export const SidebarLogo = (locale = "en") => `
  <a class="sidebar-logo" href="${appPath(locale, "home")}" aria-label="Staza home">
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

export const MobileNavigation = () => `
  <div class="mobile-navigation">
    <button class="mobile-add-activity" type="button" data-screen="add-activity">
      <img src="/assets/add-activity-upload.svg" width="16" height="16" alt="">
      <span>ADD ACTIVITY</span>
    </button>
    <nav class="mobile-nav-menu" aria-label="Primary navigation">
      ${navItems.map(([screen, label, icon]) => `
        <button class="mobile-nav-item${screen === "home" ? " is-active" : ""}" type="button" data-screen="${screen}"${screen === "home" ? ' aria-current="page"' : ""}>
          <img src="/assets/${icon}" width="20" height="20" alt="">
          <span>${label}</span>
        </button>
      `).join("")}
    </nav>
  </div>
`;

export const sidebar = Sidebar;

export const setSidebarScreen = (mountPoint, screen) => {
  for (const item of mountPoint.querySelectorAll(".sidebar-nav-item, .mobile-nav-item")) {
    const isActive =
      item.dataset.screen ===
      (screen === "activity-detail" ? "activities" : screen);
    item.classList.toggle("is-active", isActive);
    item.toggleAttribute("aria-current", isActive);
  }
  for (const item of mountPoint.querySelectorAll(".add-activity-cta, .mobile-add-activity")) {
    item.classList.toggle("is-current", screen === "add-activity");
  }
};
