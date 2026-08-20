import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const webDirectory = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(webDirectory, "../..");

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["line"]],
  outputDir: join(tmpdir(), "opentrad-playwright-results"),
  use: {
    ...devices["Desktop Chrome"],
    acceptDownloads: true,
    baseURL: "http://127.0.0.1:4173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1_440, height: 1_000 },
  },
  webServer: {
    command:
      "pnpm --filter @opentrad/document-core build && VITE_BASE_PATH=/opentrad-web/ pnpm --filter @opentrad/web exec vite --host 127.0.0.1 --port 4173 --strictPort",
    cwd: repositoryRoot,
    url: "http://127.0.0.1:4173/opentrad-web/",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
