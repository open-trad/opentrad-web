import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const runtimeDirectories = () =>
  new Set(
    readdirSync(tmpdir()).filter(
      (name) =>
        name.startsWith("opentrad-e2e-stack-") && statSync(join(tmpdir(), name)).isDirectory(),
    ),
  );

test(
  "a failure after the API listener starts closes listeners and removes every runtime artifact",
  { timeout: 30_000 },
  async (context) => {
    const blocker = createServer();
    await new Promise((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(4_173, "127.0.0.1", resolve);
    });
    const before = runtimeDirectories();
    const runId = randomUUID();
    const pointer = join(tmpdir(), `opentrad-e2e-stack-state-${runId}.json`);
    const child = spawn(
      process.execPath,
      [new URL("./start-stack.mjs", import.meta.url).pathname],
      {
        env: { ...process.env, OPENTRAD_E2E_RUN_ID: runId },
        stdio: "ignore",
      },
    );
    try {
      await once(child, "exit", { signal: context.signal });
      assert.equal(existsSync(pointer), false);
      assert.deepEqual(runtimeDirectories(), before);
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited.catch(() => undefined);
      }
      rmSync(pointer, { force: true });
      for (const name of runtimeDirectories()) {
        if (!before.has(name)) rmSync(join(tmpdir(), name), { force: true, recursive: true });
      }
    }
  },
);
