import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const webDirectory = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(webDirectory, "../..");
const runId = process.env.OPENTRAD_E2E_RUN_ID ?? randomUUID();
process.env.OPENTRAD_E2E_RUN_ID = runId;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["line"]],
  outputDir: resolve(repositoryRoot, "output/playwright/test-results"),
  globalTeardown: resolve(repositoryRoot, "scripts/e2e/teardown-stack.mjs"),
  use: {
    ...devices["Desktop Chrome"],
    acceptDownloads: true,
    baseURL: "https://opentrad.dynv6.net:4173",
    ignoreHTTPSErrors: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1_440, height: 1_000 },
  },
  webServer: {
    command: "pnpm e2e:serve",
    cwd: repositoryRoot,
    ignoreHTTPSErrors: true,
    env: { ...process.env, OPENTRAD_E2E_RUN_ID: runId },
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    url: "https://127.0.0.1:4173/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--proxy-server=direct://",
            "--host-resolver-rules=MAP opentrad.dynv6.net 127.0.0.1",
          ],
        },
        viewport: { width: 1_440, height: 1_000 },
      },
    },
    {
      name: "chromium-mobile",
      use: {
        ...devices["Pixel 7"],
        launchOptions: {
          args: [
            "--proxy-server=direct://",
            "--host-resolver-rules=MAP opentrad.dynv6.net 127.0.0.1",
          ],
        },
      },
    },
  ],
});
