import { mainContent } from "./main-content.js";
import { MobileNavigation, setSidebarScreen, sidebar } from "./sidebar.js";

export const navigableScreens = new Set(["home", "activities", "world", "progress", "profile", "add-activity"]);

export const AppShell = (locale = "en") => `
  <div class="app-shell">
    ${sidebar(locale)}
    ${mainContent()}
    ${MobileNavigation()}
  </div>
`;

export const mountAppShell = (mountPoint, onScreenChange, locale = "en") => {
  mountPoint.innerHTML = AppShell(locale);
  mountPoint.addEventListener("click", (event) => {
    const button = event.target.closest("[data-screen]");
    if (!button || !mountPoint.contains(button)) return;
    const { screen } = button.dataset;
    if (navigableScreens.has(screen)) onScreenChange(screen);
  });
  return {
    content: mountPoint.querySelector(".main-content"),
    setScreen(screen) {
      setSidebarScreen(mountPoint, screen);
    }
  };
};
