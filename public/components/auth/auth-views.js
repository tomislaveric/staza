
const logo = "/assets/logo-full.svg";
const backIcon = "/assets/auth-back.svg";
const passkeyIcon = "/assets/auth-passkey.svg";
const successIcon = "/assets/auth-success.svg";

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );

const disabled = (busy) => (busy ? ' disabled aria-disabled="true"' : "");

const layout = ({
  content,
  message = "",
  messageType = "status",
  screen,
  busy = false,
}) => `
  <main class="auth-screen auth-screen--${screen}" aria-busy="${busy}">
    <div class="auth-top-band" aria-hidden="true"></div>
    <section class="auth-content" aria-label="Authentication">
      ${content}
      <p class="auth-message" data-auth-message role="${messageType === "error" ? "alert" : "status"}" aria-live="polite">${escapeHtml(message)}</p>
    </section>
  </main>`;

const brand = () =>
  `<div class="auth-brand"><img src="${logo}" alt=""></div>`;
const back = (label = "Back") =>
  `<button class="auth-back" type="button" data-auth-back><img src="${backIcon}" width="14" height="14" alt="">${label}</button>`;

export const renderAuthSessionLoading = () => `
  <main class="auth-screen auth-session-loading" aria-busy="true" aria-label="Checking your session">
    <div class="auth-top-band" aria-hidden="true"></div>
    <div class="auth-loading-content" role="status" aria-live="polite">
      <img src="${logo}" width="48" height="48" alt="">
      <span class="auth-loader" aria-hidden="true"></span>
      <span class="sr-only">Checking your session</span>
    </div>
  </main>`;

export const renderAuthSignIn = ({ busy, message, messageType }) =>
  layout({
    screen: "sign-in",
    busy,
    message,
    messageType,
    content: `
    ${brand()}
    <div class="auth-heading auth-heading--sign-in">
      <p>Welcome back</p>
      <h1>Sign in to continue exploring.</h1>
    </div>
    <div class="auth-actions">
      <button class="auth-primary" type="button" data-auth-passkey${disabled(busy)}>
        <img src="${passkeyIcon}" width="17" height="17" alt="">Continue with passkey
      </button>
      <button class="auth-secondary" type="button" data-auth-email-login${disabled(busy)}>Use email code</button>
    </div>
    <p class="auth-security-note">Secure, passwordless sign-in</p>
    <p class="auth-account-link">New to Staza? <button type="button" data-auth-register${disabled(busy)}>Create an account</button></p>`,
  });

export const renderAuthEmailRequest = ({
  busy,
  email,
  message,
  messageType,
  purpose,
}) =>
  layout({
    screen: "email-request",
    busy,
    message,
    messageType,
    content: `
    ${back()}
    <div class="auth-heading">
      <p>${purpose === "register" ? "Create your account" : "Sign in with email"}</p>
      <h1>We'll send you a one-time code.</h1>
    </div>
    <form class="auth-form" data-auth-email-form>
      <label for="auth-email">Email</label>
      <input id="auth-email" name="email" type="email" autocomplete="email" inputmode="email" required value="${escapeHtml(email)}" placeholder="you@example.com"${disabled(busy)}>
      <button class="auth-primary" type="submit"${disabled(busy)}>${busy ? "Sending code…" : "Send code"}</button>
    </form>`,
  });

export const renderAuthVerifyEmail = ({ busy, email, message, messageType }) =>
  layout({
    screen: "verify-email",
    busy,
    message,
    messageType,
    content: `
    ${back()}
    <div class="auth-heading">
      <p>Enter code</p>
      <h1>Check your email.</h1>
      <span>We sent a one-time code to ${escapeHtml(email)}.</span>
    </div>
    <form class="auth-form" data-auth-code-form>
      <fieldset class="auth-code-input" aria-label="Six digit verification code">
        ${Array.from({ length: 6 }, (_, index) => `<input name="code-${index}" inputmode="numeric" autocomplete="${index === 0 ? "one-time-code" : "off"}" pattern="[0-9]" maxlength="1" required${disabled(busy)}>`).join("")}
      </fieldset>
      <button class="auth-primary" type="submit"${disabled(busy)}>${busy ? "Verifying…" : "Verify code"}</button>
    </form>
    <button class="auth-text-action" type="button" data-auth-resend${disabled(busy)}>Send a new code</button>`,
  });

export const renderAuthCreatePasskey = ({ busy, message, messageType }) =>
  layout({
    screen: "create-passkey",
    busy,
    message,
    messageType,
    content: `
    ${back()}
    <div class="auth-heading">
      <p>Secure your account</p>
      <h1>Create a passkey for faster sign-in.</h1>
    </div>
    <ul class="auth-benefits">
      <li><i aria-hidden="true">⬡</i><span><strong>No password needed</strong>Sign in with your device — no credentials to remember.</span></li>
      <li><i aria-hidden="true">◈</i><span><strong>Uses device security</strong>Face ID, Touch ID, Windows Hello, or your device PIN.</span></li>
      <li><i aria-hidden="true">◇</i><span><strong>Private by default</strong>Your biometric data never leaves your device.</span></li>
    </ul>
    <button class="auth-primary" type="button" data-auth-register-passkey${disabled(busy)}>${busy ? "Creating passkey…" : "Create passkey"}</button>
    <button class="auth-text-action" type="button" data-auth-skip-passkey${disabled(busy)}>Later</button>`,
  });

export const renderAuthPasskeyReady = () =>
  layout({
    screen: "passkey-ready",
    content: `
    <div class="auth-success">
      ${brand()}
      <div class="auth-success-icon" aria-hidden="true"><img src="${successIcon}" width="32" height="32" alt=""></div>
      <p>Passkey ready</p>
      <h1>Your account is secured.</h1>
      <span>You can now sign in instantly with your device.</span>
      <button class="auth-primary" type="button" data-auth-continue>Continue to Staza</button>
    </div>`,
  });

export const renderAuthError = ({ unavailable, message }) =>
  layout({
    screen: unavailable ? "passkey-unavailable" : "error",
    message: "",
    content: `
    ${brand()}
    <div class="auth-heading">
      <p>${unavailable ? "Passkey unavailable" : "Sign-in issue"}</p>
      <h1>${unavailable ? "Passkeys aren't available on this device." : "We couldn't verify your sign-in."}</h1>
      <span role="alert">${escapeHtml(message)}</span>
    </div>
    <div class="auth-actions">
      <button class="auth-primary" type="button" data-auth-retry>${unavailable ? "Try again" : "Try again"}</button>
      <button class="auth-secondary" type="button" data-auth-email-login>Use email code</button>
    </div>
    <p class="auth-account-link">New to Staza? <button type="button" data-auth-register>Create an account</button></p>`,
  });
