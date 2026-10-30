import { mainContent } from "./main-content.js";
import { MobileHeader, MobileNavigation, setMobileMoreOpen, setSidebarScreen, sidebar } from "./sidebar.js";

export const navigableScreens = new Set(["home", "activities", "world", "skill-tree", "progress", "profile", "add-activity"]);

export const AppShell = (locale = "en") => `
  <div class="app-shell">
    ${MobileHeader(locale)}
    ${sidebar(locale)}
    ${mainContent()}
    ${MobileNavigation(locale)}
  </div>
`;

export const mountAppShell = (mountPoint, onScreenChange, locale = "en") => {
  mountPoint.innerHTML = AppShell(locale);
  // Listeners live on the shell element so remounting the shell does not stack handlers.
  const shell = mountPoint.querySelector(".app-shell");
  const moreToggle = shell.querySelector("[data-mobile-more]");
  const moreMenu = shell.querySelector("[data-mobile-more-menu]");
  shell.addEventListener("click", (event) => {
    if (event.target.closest("[data-mobile-more]")) {
      setMobileMoreOpen(shell, moreMenu.hidden);
      if (!moreMenu.hidden) moreMenu.querySelector("button")?.focus();
      return;
    }
    if (!moreMenu.hidden && !event.target.closest("[data-mobile-more-menu]")) setMobileMoreOpen(shell, false);
    const button = event.target.closest("[data-screen]");
    if (!button) return;
    const { screen } = button.dataset;
    if (navigableScreens.has(screen)) onScreenChange(screen);
  });
  shell.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || moreMenu.hidden) return;
    setMobileMoreOpen(shell, false);
    moreToggle.focus();
  });
  return {
    content: shell.querySelector(".main-content"),
    setScreen(screen) {
      setSidebarScreen(shell, screen);
    }
  };
};
