import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Empty DATABASE_URL: Next never overrides a set variable from .env.local, so e2e stays DB-less (and off
    // the real database) on machines that have one configured.
    env: { PERPLOG_FIXTURE_DIR: "../../packages/core/test/fixtures", DATABASE_URL: "" },
  },
});
