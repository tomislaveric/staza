import { getAppLocale } from "../../app-locales.js";
import { disconnectStrava, loadStravaStatus, requestStravaAuthorization } from "../strava-import.js";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

const formatNumber = (value, maximumFractionDigits = 0) => new Intl.NumberFormat(getAppLocale(), { maximumFractionDigits }).format(value);
const formatDate = (value) => new Intl.DateTimeFormat(getAppLocale(), { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
const json = async (response) => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Unable to complete that request.");
  return body;
};

const tabs = (screen) => `<nav class="profile-tabs" aria-label="Profile navigation">
  ${[["overview", "Profile"], ["account", "Account & Security"], ["passkeys", "Passkeys"], ["delete", "Delete Account"]].map(([value, label]) =>
    `<button type="button" data-profile-screen="${value}"${screen === value ? ' class="is-active" aria-current="page"' : ""}>${label}</button>`).join("")}
</nav>`;
const shell = (screen, body) => `<section class="profile-page">${tabs(screen)}${body}</section>`;
const row = (label, detail, action, danger = false) => `<button type="button" class="profile-row${danger ? " is-danger" : ""}" ${action ? `data-profile-action="${action}"` : "disabled"}>
  <span><strong>${typeof label === "string" ? escapeHtml(label) : `<span data-user-content>${escapeHtml(label.value)}</span>`}</strong>${detail ? `<small>${typeof detail === "string"
    ? escapeHtml(detail)
    : `<span data-user-content>${escapeHtml(detail.email)}</span>${detail.verified ? ` · ${escapeHtml(detail.verified)}` : ""}`}</small>` : ""}</span>
</button>`;

const stravaConnection = (status) => {
  if (status === "connected") {
    return `${row("Strava", "Connected")}${row("Disconnect Strava", "Removes Staza's access to your Strava account", "strava-disconnect", true)}`;
  }
  if (status === "reconnect_required") {
    return `${row("Reconnect Strava", "Your Strava connection expired", "strava-connect")}${row("Disconnect Strava", "Removes Staza's access to your Strava account", "strava-disconnect", true)}`;
  }
  return row("Connect Strava", "Import recent activities from Strava", "strava-connect");
};

export const profileOverviewView = (profile, session, stravaStatus) => {
  const { progress, collectibles } = profile;
  const initial = profile.displayName.trim().slice(0, 1).toUpperCase() || "?";
  return shell("overview", `
    <header class="profile-heading"><h1>Profile</h1></header>
    <section class="profile-identity">
      <span class="profile-avatar" aria-hidden="true">${escapeHtml(initial)}</span>
      <div><strong data-user-content>${escapeHtml(profile.displayName)}</strong></div>
      <b>LVL ${formatNumber(progress.level)}</b>
    </section>
    <section class="profile-progress" aria-label="Level progress">
      <p><span>Level ${formatNumber(progress.level)}</span><span>${formatNumber(progress.currentLevelXp)} / ${formatNumber(progress.nextLevelXp)} XP</span></p>
      <div role="progressbar" aria-valuemin="0" aria-valuemax="${progress.nextLevelXp}" aria-valuenow="${progress.currentLevelXp}"><i style="width:${Math.max(0, Math.min(100, progress.progressToNextLevel * 100))}%"></i></div>
    </section>
    <section class="profile-section"><h2>EXPLORER RECORD</h2><dl class="profile-stats">
      <div><dt>Total XP earned</dt><dd>${formatNumber(progress.totalXp)} XP</dd></div>
      <div><dt>Distance</dt><dd>${formatNumber(profile.distanceMeters / 1000, 1)} km</dd></div>
      <div><dt>Activities completed</dt><dd>${formatNumber(profile.activityCount)}</dd></div>
      <div><dt>Collectibles found</dt><dd>${formatNumber(collectibles.discoveredCount)} of ${formatNumber(collectibles.totalCollectibles)}</dd></div>
      <div><dt>Rare &amp; epic</dt><dd>${formatNumber(collectibles.rareFinds)} rare · ${formatNumber(collectibles.epicFinds)} epic</dd></div>
    </dl></section>
    <section class="profile-section"><h2>ACCOUNT &amp; SECURITY</h2><div class="profile-card">
      ${row("Account email", { email: session.user.email, verified: session.user.emailVerified ? "Verified" : "" }, "account")}
      ${row("Passkeys", "Manage registered passkeys", "passkeys")}
      ${row("Sessions", "Sign out or manage active devices", "account")}
    </div></section>
    ${["connected", "disconnected", "reconnect_required"].includes(stravaStatus)
      ? `<section class="profile-section"><h2>CONNECTIONS</h2><div class="profile-card">${stravaConnection(stravaStatus)}</div></section>`
      : ""}`);
};

export const profileAccountView = (session, passkeyCount) => shell("account", `
  <button class="profile-back" type="button" data-profile-screen="overview">‹ Profile</button>
  <header class="profile-heading"><h1>Account &amp; Security</h1><p>Authentication and account settings</p></header>
  <section class="profile-section"><h2>ACCOUNT EMAIL</h2><div class="profile-card">${row({ value: session.user.email }, session.user.emailVerified ? "Verified" : "Not verified")}</div></section>
  <section class="profile-section"><h2>PASSKEYS</h2><div class="profile-card">${row("Manage passkeys", `${formatNumber(passkeyCount)} registered`, "passkeys")}${row("Add passkey", "", "add-passkey")}</div><p class="profile-help">Passkeys use your device to sign in without a password.</p></section>
  <section class="profile-section"><h2>SESSIONS</h2><div class="profile-card">${row("Sign out", "", "logout")}${row("Sign out all devices", "Ends all active sessions including this one", "logout-all", true)}</div></section>
  <section class="profile-section"><h2>PRIVACY &amp; ACCOUNT</h2><div class="profile-card">${row("Export my data", "Download a copy of your account and activity data", "export")}</div></section>
  <section class="profile-section"><h2>DANGER ZONE</h2><div class="profile-card profile-danger">${row("Delete account", "Permanently removes your account and data", "delete", true)}</div></section>`);

export const profilePasskeysView = (passkeys) => shell("passkeys", `
  <button class="profile-back" type="button" data-profile-screen="account">‹ Account &amp; Security</button>
  <header class="profile-heading"><h1>Passkeys</h1><p>${formatNumber(passkeys.length)} registered on your account</p></header>
  <section class="passkey-list">${passkeys.map((passkey) => `<article class="passkey-row"><div><strong data-user-content>${escapeHtml(passkey.name)}</strong><small>Added ${formatDate(passkey.createdAt)}${passkey.lastUsedAt ? ` · Last used ${formatDate(passkey.lastUsedAt)}` : ""}</small></div><button type="button" data-remove-passkey="${escapeHtml(passkey.id)}">Remove</button></article>`).join("")}</section>
  <button class="profile-ghost-button" type="button" data-profile-action="add-passkey">Add passkey</button>
  <p class="profile-help">Keep at least one passkey registered. You can still sign in with an email code.</p>`);

export const profileDeleteView = (confirmed) => shell("delete", `
  <button class="profile-back" type="button" data-profile-screen="account">‹ Account &amp; Security</button>
  <header class="profile-heading"><span class="profile-eyebrow">DANGER ZONE</span><h1>Delete account.</h1><p>This permanently removes your account, authentication credentials, and associated data.</p></header>
  <section class="profile-delete-warning"><h2>THIS WILL PERMANENTLY DELETE</h2><ul><li>Your account and sign-in credentials</li><li>All activity and exploration data</li><li>Collectibles and progression history</li><li>Associated passkeys and sessions</li></ul></section>
  <label class="profile-check"><input type="checkbox" data-delete-ack${confirmed ? " checked" : ""}> I understand this action is permanent and cannot be undone.</label>
  <button class="profile-danger-button" type="button" data-profile-action="confirm-delete"${confirmed ? "" : " disabled"}>Delete account</button>
  <button class="profile-ghost-button" type="button" data-profile-screen="account">Cancel</button>`);

const stepUpView = () => shell("account", `<header class="profile-heading"><h1>Confirm your email</h1><p>Enter the code sent to your account email to continue.</p></header><form class="profile-step-up" data-step-up-form><label>Verification code<input name="code" inputmode="numeric" autocomplete="one-time-code" required maxlength="6"></label><button class="profile-ghost-button" type="submit">Continue</button><button class="profile-back" type="button" data-profile-screen="account">Cancel</button></form>`);

export const mountProfilePage = (root, { fetch: request, session, startRegistration, onUnauthenticated }) => {
  let screen = "overview";
  let profile;
  let passkeys = [];
  let pendingAction;
  const render = (view) => { root.innerHTML = view; bind(); };
  const loadPasskeys = async () => { passkeys = await json(await request("/api/auth/passkeys")); };
  const showError = (message) => { root.insertAdjacentHTML("afterbegin", `<p class="profile-message" role="alert">${escapeHtml(message)}</p>`); };
  const show = async () => {
    try {
      if (screen === "overview") {
        root.innerHTML = '<section class="profile-page"><p class="profile-loading" role="status">Loading Profile...</p></section>';
        const [loadedProfile, stravaStatus] = await Promise.all([
          request("/api/player/profile").then(json),
          loadStravaStatus(request).catch(() => "disabled")
        ]);
        profile = loadedProfile;
        render(profileOverviewView(profile, session, stravaStatus));
      } else if (screen === "account") { await loadPasskeys(); render(profileAccountView(session, passkeys.length)); }
      else if (screen === "passkeys") { await loadPasskeys(); render(profilePasskeysView(passkeys)); }
      else render(profileDeleteView(false));
    } catch { root.innerHTML = '<section class="profile-page"><p class="profile-message" role="alert">Unable to load Profile. Try again.</p></section>'; }
  };
  const stepUp = async (action) => {
    pendingAction = action;
    try { await json(await request("/api/auth/step-up/email/request", { method: "POST" })); render(stepUpView()); }
    catch { showError("Unable to start verification. Try again."); }
  };
  const execute = async (action) => {
    try {
      if (action === "account" || action === "passkeys") {
        screen = action;
        await show();
        return;
      }
      if (action === "logout" || action === "logout-all") { await request(`/api/auth/${action}`, { method: "POST" }); onUnauthenticated(); return; }
      if (action === "add-passkey") {
        const options = await json(await request("/api/auth/passkeys/register/options", { method: "POST" }));
        const credential = await startRegistration({ optionsJSON: options });
        const response = await request("/api/auth/passkeys/register/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(credential) });
        if (!response.ok) await json(response);
        screen = "passkeys"; await show(); return;
      }
      if (action === "strava-connect") { await requestStravaAuthorization(request); return; }
      if (action === "strava-disconnect") { await disconnectStrava(request); await show(); return; }
      if (action === "export") { window.location.assign("/api/account/export"); return; }
      if (action === "delete") { screen = "delete"; await show(); return; }
      if (action === "confirm-delete") {
        const intent = await json(await request("/api/account/deletion-intent", { method: "POST" }));
        const response = await request("/api/account/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmationToken: intent.confirmationToken }) });
        if (!response.ok) await json(response);
        onUnauthenticated(); return;
      }
    } catch (error) {
      if (/Recent step-up authentication/.test(error.message)) return stepUp(action);
      showError(action === "add-passkey" ? "We couldn't add your passkey. Try again." : "Unable to complete that action. Try again.");
    }
  };
  const bind = () => {
    root.querySelectorAll("[data-profile-screen]").forEach((button) => button.addEventListener("click", async () => { screen = button.dataset.profileScreen; await show(); }));
    root.querySelectorAll("[data-profile-action]").forEach((button) => button.addEventListener("click", () => execute(button.dataset.profileAction)));
    root.querySelector("[data-delete-ack]")?.addEventListener("change", (event) => { root.querySelector("[data-profile-action=\"confirm-delete\"]").disabled = !event.target.checked; });
    root.querySelectorAll("[data-remove-passkey]").forEach((button) => button.addEventListener("click", async () => {
      try { const response = await request(`/api/auth/passkeys/${encodeURIComponent(button.dataset.removePasskey)}`, { method: "DELETE" }); if (!response.ok) await json(response); await show(); }
      catch (error) { if (/Recent step-up authentication/.test(error.message)) stepUp("passkeys"); else showError("We couldn't remove that passkey. Try again."); }
    }));
    root.querySelector("[data-step-up-form]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      try { const response = await request("/api/auth/step-up/email/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: new FormData(event.currentTarget).get("code") }) }); if (!response.ok) await json(response); if (pendingAction === "passkeys") { screen = "passkeys"; await show(); } else await execute(pendingAction); }
      catch { showError("This code is invalid or has expired. Try again."); }
    });
  };
  show();
};
