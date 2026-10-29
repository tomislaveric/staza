import {
  renderAuthCreatePasskey,
  renderAuthEmailRequest,
  renderAuthError,
  renderAuthPasskeyReady,
  renderAuthSessionLoading,
  renderAuthSignIn,
  renderAuthVerifyEmail
} from "./auth-views.js";

export const authEndpoints = {
  loginCode: "/api/auth/email-code/request",
  loginVerify: "/api/auth/email-code/verify",
  registerCode: "/api/auth/register/code",
  registerVerify: "/api/auth/register/verify"
};

const json = async (response) => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Unable to complete that request.");
  return body;
};

export const isPasskeyUnavailable = (error) => error?.name === "NotSupportedError" || error?.name === "SecurityError";
const isPasskeyCancellation = (error) => error?.name === "NotAllowedError";

export const safeAuthMessage = (error, fallback) => error instanceof Error && error.message ? fallback : fallback;

export const mountAuthSessionLoading = (root) => {
  root.innerHTML = renderAuthSessionLoading();
};

export const mountAuthFlow = (root, {
  fetch: request,
  startAuthentication,
  startRegistration,
  onSession,
  onAuthenticated,
  initialPurpose = "login",
  onPurposeChange = () => {},
  initialMessage = ""
}) => {
  let state = {
    screen: initialPurpose === "register" ? "email-request" : "sign-in",
    purpose: initialPurpose,
    email: "",
    busy: false,
    message: initialMessage,
    messageType: initialMessage ? "error" : "status"
  };

  const show = (next) => {
    state = { ...state, ...next };
    onPurposeChange(state.purpose);
    if (state.screen === "sign-in") root.innerHTML = renderAuthSignIn(state);
    else if (state.screen === "email-request") root.innerHTML = renderAuthEmailRequest(state);
    else if (state.screen === "verify-email") root.innerHTML = renderAuthVerifyEmail(state);
    else if (state.screen === "create-passkey") root.innerHTML = renderAuthCreatePasskey(state);
    else if (state.screen === "passkey-ready") root.innerHTML = renderAuthPasskeyReady();
    else root.innerHTML = renderAuthError(state);
    bind();
  };

  const fail = (message, unavailable = false) => show({
    screen: "error", busy: false, unavailable, message, messageType: "error"
  });

  const requestCode = async (email = state.email) => {
    show({ busy: true, message: "", messageType: "status", email });
    try {
      await json(await request(state.purpose === "register" ? authEndpoints.registerCode : authEndpoints.loginCode, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email })
      }));
      show({ screen: "verify-email", busy: false, email, message: "", messageType: "status" });
      root.querySelector("[name=\"code-0\"]")?.focus();
    } catch {
      show({ busy: false, message: "We couldn't send a code. Try again.", messageType: "error" });
    }
  };

  const verifyCode = async (code) => {
    show({ busy: true, message: "", messageType: "status" });
    try {
      const body = await json(await request(state.purpose === "register" ? authEndpoints.registerVerify : authEndpoints.loginVerify, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: state.email, code })
      }));
      if (state.purpose === "login" && !body.authenticated) {
        show({
          screen: "email-request",
          purpose: "register",
          busy: false,
          message: "No account was found for this email. Create one with a new verification code.",
          messageType: "status"
        });
        return;
      }
      onSession(body);
      if (state.purpose === "register") show({ screen: "create-passkey", busy: false, message: "", messageType: "status" });
      else onAuthenticated();
    } catch {
      show({ busy: false, message: "This code is invalid or has expired. Request a new one.", messageType: "error" });
    }
  };

  const signInWithPasskey = async () => {
    show({ busy: true, message: "", messageType: "status" });
    try {
      const options = await json(await request("/api/auth/passkeys/login/options", { method: "POST" }));
      const credential = await startAuthentication({ optionsJSON: options });
      const body = await json(await request("/api/auth/passkeys/login/verify", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(credential)
      }));
      onSession(body);
      onAuthenticated();
    } catch (error) {
      if (isPasskeyCancellation(error)) show({ busy: false, message: "Passkey sign-in was cancelled.", messageType: "status" });
      else fail(isPasskeyUnavailable(error) ? "Use an email code to sign in on this device." : "Something went wrong during sign-in. Try again, or use email code.", isPasskeyUnavailable(error));
    }
  };

  const createPasskey = async () => {
    show({ busy: true, message: "", messageType: "status" });
    try {
      const options = await json(await request("/api/auth/passkeys/register/options", { method: "POST" }));
      const credential = await startRegistration({ optionsJSON: options });
      const response = await request("/api/auth/passkeys/register/verify", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(credential)
      });
      if (!response.ok) await json(response);
      show({ screen: "passkey-ready", busy: false, message: "", messageType: "status" });
    } catch {
      show({ busy: false, message: "We couldn't create your passkey. Try again.", messageType: "error" });
    }
  };

  const bindCodeInputs = () => {
    const inputs = [...root.querySelectorAll(".auth-code-input input")];
    inputs.forEach((input, index) => {
      input.addEventListener("input", () => {
        input.value = input.value.replace(/\D/g, "").slice(-1);
        if (input.value && index < inputs.length - 1) inputs[index + 1].focus();
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Backspace" && !input.value && index > 0) inputs[index - 1].focus();
      });
      input.addEventListener("paste", (event) => {
        const digits = event.clipboardData?.getData("text").replace(/\D/g, "").slice(0, 6);
        if (!digits) return;
        event.preventDefault();
        digits.split("").forEach((digit, digitIndex) => { if (inputs[digitIndex]) inputs[digitIndex].value = digit; });
        inputs[Math.min(digits.length, 6) - 1]?.focus();
      });
    });
  };

  const bind = () => {
    root.querySelector("[data-auth-passkey]")?.addEventListener("click", signInWithPasskey);
    root.querySelector("[data-auth-email-login]")?.addEventListener("click", () => show({ screen: "email-request", purpose: "login", message: "", messageType: "status" }));
    root.querySelector("[data-auth-register]")?.addEventListener("click", () => show({ screen: "email-request", purpose: "register", message: "", messageType: "status" }));
    root.querySelector("[data-auth-back]")?.addEventListener("click", () => {
      if (state.screen === "create-passkey") {
        show({ busy: false, message: "Create a passkey to finish securing your account.", messageType: "status" });
        return;
      }
      const returningToSignIn = state.screen !== "verify-email";
      show({
        screen: returningToSignIn ? "sign-in" : "email-request",
        purpose: returningToSignIn ? "login" : state.purpose,
        busy: false,
        message: "",
        messageType: "status"
      });
    });
    root.querySelector("[data-auth-retry]")?.addEventListener("click", signInWithPasskey);
    root.querySelector("[data-auth-register-passkey]")?.addEventListener("click", createPasskey);
    root.querySelector("[data-auth-skip-passkey]")?.addEventListener("click", onAuthenticated);
    root.querySelector("[data-auth-continue]")?.addEventListener("click", onAuthenticated);
    root.querySelector("[data-auth-resend]")?.addEventListener("click", () => requestCode());
    root.querySelector("[data-auth-email-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      requestCode(new FormData(event.currentTarget).get("email"));
    });
    root.querySelector("[data-auth-code-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      verifyCode([...event.currentTarget.querySelectorAll(".auth-code-input input")].map((input) => input.value).join(""));
    });
    bindCodeInputs();
  };

  show(state);
};
