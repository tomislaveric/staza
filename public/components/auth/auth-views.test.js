import { describe, expect, it } from "vitest";
import { authEndpoints, isPasskeyUnavailable } from "./auth-flow.js";
import {
  renderAuthCreatePasskey,
  renderAuthEmailRequest,
  renderAuthError,
  renderAuthPasskeyReady,
  renderAuthSessionLoading,
  renderAuthSignIn,
  renderAuthVerifyEmail
} from "./auth-views.js";

describe("authentication presentation", () => {
  it("renders the Figma session-loading view without private application content", () => {
    const view = renderAuthSessionLoading();
    expect(view).toContain("Checking your session");
    expect(view).not.toContain("app-shell");
  });

  it("renders passkey-first sign-in with email and registration transitions", () => {
    const view = renderAuthSignIn({ busy: false, message: "", messageType: "status" });
    expect(view).toContain("Continue with passkey");
    expect(view).toContain("Use email code");
    expect(view).toContain("Create an account");
  });

  it("renders the request, code-entry, passkey-setup, success, and error states", () => {
    expect(renderAuthEmailRequest({ busy: false, email: "rider@example.com", purpose: "register", message: "", messageType: "status" })).toContain("Send code");
    expect(renderAuthVerifyEmail({ busy: false, email: "rider@example.com", message: "", messageType: "status" }).match(/name="code-\d"/g)).toHaveLength(6);
    expect(renderAuthCreatePasskey({ busy: false, message: "", messageType: "status" })).toContain("Create passkey");
    expect(renderAuthCreatePasskey({ busy: false, message: "", messageType: "status" })).toContain("data-auth-skip-passkey");
    expect(renderAuthPasskeyReady()).toContain("Continue to Staza");
    expect(renderAuthError({ unavailable: true, message: "Use an email code to sign in on this device." })).toContain("Passkey unavailable");
    expect(renderAuthError({ unavailable: true, message: "Use an email code to sign in on this device." })).toContain("Create an account");
  });

  it("keeps the canonical endpoint split and classifies unsupported passkeys", () => {
    expect(authEndpoints.loginCode).not.toBe(authEndpoints.registerCode);
    expect(authEndpoints.loginVerify).not.toBe(authEndpoints.registerVerify);
    expect(isPasskeyUnavailable({ name: "NotSupportedError" })).toBe(true);
    expect(isPasskeyUnavailable({ name: "NotAllowedError" })).toBe(false);
  });
});
