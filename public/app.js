import { mountAppShell } from "./components/app-shell.js";
import { mountAddActivityPage } from "./components/add-activity-page.js";
import { mountHomePage } from "./components/home-page.js";
import { mountProgressPage } from "./components/progress-page.js";
import { mountActivityDetailPage } from "./components/activity-detail-page.js";
import { mountActivitiesPage } from "./components/activities-page.js";
import { mountWorldPage } from "./components/world-page.js";
import { mountSkillTreePage } from "./components/skill-tree-page.js";
import { mountProfilePage } from "./components/profile/profile-page.js";
import { startAuthentication, startRegistration } from "/shared/webauthn/index.js";
import { mountAuthFlow, mountAuthSessionLoading } from "./components/auth/auth-flow.js";
import {
  appPath,
  getLocalePreference,
  localizeAppUi,
  parseAppPath,
  setAppLocale,
  setLocalePreference
} from "./app-locales.js";
import { initComingSoon } from "./components/shared/coming-soon.js";

const app = document.querySelector("#app");
const nativeFetch = window.fetch.bind(window);
let csrfToken;
let currentSession;
let currentRoute = parseAppPath(window.location.pathname, navigator.languages, getLocalePreference());
let sessionChecked = false;

const setDocumentLocale = (locale) => {
  setAppLocale(locale);
  document.documentElement.lang = locale;
};

const localizeRoot = () => localizeAppUi(app, currentRoute.locale);

new MutationObserver(localizeRoot).observe(app, { childList: true, characterData: true, subtree: true });
window.addEventListener("popstate", () => {
  currentRoute = parseAppPath(window.location.pathname, navigator.languages, getLocalePreference());
  setDocumentLocale(currentRoute.locale);
  renderCurrentRoute();
});

app.addEventListener("change", (event) => {
  if (!event.target.matches?.("[data-locale-selector]")) return;
  setLocalePreference(event.target.value);
  window.location.reload();
});

const setRoute = (screen, { activityId, replace = false } = {}) => {
  const path = appPath(screen, activityId);
  if (window.location.pathname !== path) {
    window.history[replace ? "replaceState" : "pushState"](null, "", path);
  }
  currentRoute = parseAppPath(path, navigator.languages, getLocalePreference());
  setDocumentLocale(currentRoute.locale);
};

const authenticateFetch = (input, init = {}) => {
  const method = (init.method ?? "GET").toUpperCase();
  const url = typeof input === "string" ? input : input.url;
  if (csrfToken && url.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    const headers = new Headers(init.headers);
    headers.set("X-CSRF-Token", csrfToken);
    return nativeFetch(input, { ...init, headers });
  }
  return nativeFetch(input, init);
};

const mountPrivateApp = () => {
  const shell = mountAppShell(app, navigateScreen, currentRoute.locale);
  let selectedActivityId = currentRoute.activityId;
  function navigateScreen(screen, activityId, skillNodeId) {
    setRoute(screen, { activityId });
    if (screen === "activity-detail") selectedActivityId = activityId;
    showScreen(screen, skillNodeId);
  }
  function showScreen(screen, skillNodeId) {
    shell.setScreen(screen);
    if (screen === "add-activity") mountAddActivityPage(shell.content, selectActivity);
    else if (screen === "activities") mountActivitiesPage(shell.content, selectActivity);
    else if (screen === "activity-detail") mountActivityDetailPage(shell.content, selectedActivityId, () => navigateScreen("activities"), navigateScreen);
    else if (screen === "world") mountWorldPage(shell.content, (nodeId) => navigateScreen("skill-tree", undefined, nodeId));
    else if (screen === "skill-tree") mountSkillTreePage(shell.content, skillNodeId);
    else if (screen === "progress") mountProgressPage(shell.content);
    else if (screen === "profile") mountProfilePage(shell.content, {
      fetch: authenticateFetch,
      session: currentSession,
      startRegistration,
      onUnauthenticated: () => {
        csrfToken = undefined;
        currentSession = undefined;
        window.fetch = nativeFetch;
        mountSignIn();
      }
    });
    else mountHomePage(shell.content, selectActivity, navigateScreen);
    shell.content.focus({ preventScroll: true });
  }
  function selectActivity(activityId) {
    selectedActivityId = String(activityId);
    navigateScreen("activity-detail", selectedActivityId);
  }
  const screen = currentRoute.screen;
  if (screen === "sign-in" || screen === "register" || screen === "not-found") {
    setRoute("home", { replace: true });
    showScreen("home");
  } else showScreen(screen);
};

const configureSession = (session) => {
  csrfToken = session.csrfToken;
  currentSession = session;
  window.fetch = authenticateFetch;
};

const mountSignIn = (message = "") => mountAuthFlow(app, {
  fetch: authenticateFetch,
  startAuthentication,
  startRegistration,
  onSession: configureSession,
  onAuthenticated: () => {
    setRoute("home", { replace: true });
    mountPrivateApp();
  },
  initialMessage: message,
  initialPurpose: currentRoute.screen === "register" ? "register" : "login",
  onPurposeChange: (purpose) => {
    const screen = purpose === "register" ? "register" : "sign-in";
    if (screen !== currentRoute.screen) setRoute(screen);
  }
});

const showNotFound = () => {
  app.innerHTML = `<main class="auth-screen"><section class="auth-content"><h1>Page not found</h1><a href="${appPath("sign-in")}">Sign in</a></section></main>`;
  localizeRoot();
};

const renderCurrentRoute = () => {
  if (!sessionChecked) return;
  if (currentRoute.screen === "not-found") return showNotFound();
  if (currentSession) return mountPrivateApp();
  if (currentRoute.screen !== "sign-in" && currentRoute.screen !== "register") {
    setRoute("sign-in", { replace: true });
  }
  mountSignIn();
};

setDocumentLocale(currentRoute.locale);
initComingSoon();
mountAuthSessionLoading(app);
nativeFetch("/api/auth/session").then((response) => response.json()).then((session) => {
  sessionChecked = true;
  if (!session.authenticated) return renderCurrentRoute();
  configureSession(session);
  renderCurrentRoute();
}).catch(() => {
  sessionChecked = true;
  if (currentRoute.screen !== "sign-in" && currentRoute.screen !== "register") {
    setRoute("sign-in", { replace: true });
  }
  mountSignIn("Unable to check your session.");
});
