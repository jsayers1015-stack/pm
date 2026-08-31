import { defineConfig, devices } from "@playwright/test";

// Tests run against the app served by FastAPI, so start the container first
// (scripts/start.ps1 or scripts/start.sh). Override with BASE_URL to target
// `next dev` on port 3000 instead.
const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  testDir: "./tests",
  // The MVP has one board for one user, so parallel tests would clobber each
  // other's changes now that mutations persist.
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
