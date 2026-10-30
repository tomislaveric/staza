import { mkdir, writeFile } from "node:fs/promises";
import type { FullConfig } from "@playwright/test";
import { createTestSession } from "./session.js";

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = String(config.projects[0].use.baseURL);
  const email = process.env.E2E_USER_EMAIL ?? "e2e-mobile@staza.test";
  const { token, activityId } = await createTestSession(email);
  // Workers inherit environment variables set during global setup.
  if (activityId) process.env.E2E_ACTIVITY_ID = activityId;
  const { hostname } = new URL(baseURL);
  await mkdir("e2e/.auth", { recursive: true });
  await writeFile("e2e/.auth/session.json", JSON.stringify({
    cookies: [{
      name: "session", value: token, domain: hostname, path: "/",
      expires: -1, httpOnly: true, secure: false, sameSite: "Lax"
    }],
    origins: []
  }));
}
