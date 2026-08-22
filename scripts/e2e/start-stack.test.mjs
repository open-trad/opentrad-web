import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./start-stack.mjs", import.meta.url), "utf8");
const config = readFileSync(
  new URL("../../apps/web/playwright.config.ts", import.meta.url),
  "utf8",
);

test("the production-like proxy replaces client-supplied forwarded headers", () => {
  assert.match(source, /"x-forwarded-for":\s*"127\.0\.0\.1"/u);
  assert.match(source, /"x-forwarded-host":\s*publicHost/u);
  assert.match(source, /"x-forwarded-proto":\s*"https"/u);
  assert.doesNotMatch(source, /headers:\s*\{\s*\.\.\.request\.headers,\s*host:/u);
});

test("Playwright owns one stack and asks it to shut down gracefully", () => {
  assert.match(config, /reuseExistingServer:\s*false/u);
  assert.match(config, /gracefulShutdown:\s*\{[\s\S]*signal:\s*"SIGTERM"[\s\S]*timeout:/u);
  assert.match(config, /globalTeardown:/u);
  assert.match(source, /OPENTRAD_E2E_RUN_ID/u);
});
