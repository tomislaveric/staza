import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    storageState: "e2e/.auth/session.json",
    trace: "retain-on-failure"
  },
  projects: [
    { name: "small-phone", use: { ...devices["iPhone SE"], browserName: "chromium", viewport: { width: 320, height: 568 } } },
    { name: "phone", use: { ...devices["Pixel 7"], browserName: "chromium", viewport: { width: 390, height: 844 } } },
    { name: "tablet", use: { browserName: "chromium", viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } }
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: "npx tsx src/server.ts",
    url: `${baseURL}/api/auth/session`,
    reuseExistingServer: true,
    timeout: 120_000
  }
});
