import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import teardownStack from "./teardown-stack.mjs";

test("teardown never signals a PID that is not owned by the current run", async () => {
  const runId = randomUUID();
  const runtimeRoot = mkdtempSync(join(tmpdir(), "opentrad-e2e-stack-"));
  const pointerPath = join(tmpdir(), `opentrad-e2e-stack-state-${runId}.json`);
  const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  writeFileSync(pointerPath, `${JSON.stringify({ pid: unrelated.pid, runId, runtimeRoot })}\n`, {
    mode: 0o600,
  });
  const previousRunId = process.env.OPENTRAD_E2E_RUN_ID;
  process.env.OPENTRAD_E2E_RUN_ID = runId;
  try {
    await teardownStack();
    assert.equal(unrelated.exitCode, null, "teardown killed an unrelated reused PID");
    assert.equal(unrelated.signalCode, null, "teardown signalled an unrelated reused PID");
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
    assert.equal(existsSync(pointerPath), false);
    assert.equal(existsSync(runtimeRoot), false);
  } finally {
    if (previousRunId === undefined) delete process.env.OPENTRAD_E2E_RUN_ID;
    else process.env.OPENTRAD_E2E_RUN_ID = previousRunId;
    rmSync(pointerPath, { force: true });
    rmSync(runtimeRoot, { force: true, recursive: true });
    if (unrelated.exitCode === null && unrelated.signalCode === null) {
      const exited = once(unrelated, "exit");
      unrelated.kill("SIGKILL");
      await exited.catch(() => undefined);
    }
  }
});
