import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export default async function teardownStack() {
  const runId = process.env.OPENTRAD_E2E_RUN_ID;
  if (!runId || !/^[0-9a-f-]{36}$/u.test(runId)) return;
  const pointerPath = join(tmpdir(), `opentrad-e2e-stack-state-${runId}.json`);
  if (!existsSync(pointerPath)) return;
  const state = JSON.parse(readFileSync(pointerPath, "utf8"));
  if (state.runId !== runId || !Number.isSafeInteger(state.pid) || state.pid < 1) return;
  const runtimeRoot = resolve(state.runtimeRoot);
  if (
    dirname(runtimeRoot) !== resolve(tmpdir()) ||
    !basename(runtimeRoot).startsWith("opentrad-e2e-stack-")
  ) {
    throw new Error("E2E_RUNTIME_ROOT_INVALID");
  }
  let ownedProcess = false;
  try {
    const command = execFileSync("ps", ["-p", String(state.pid), "-o", "command="], {
      encoding: "utf8",
    }).trim();
    ownedProcess = command.startsWith(`opentrad-e2e-${runId}`);
  } catch {
    // A missing process is a stale run pointer; only its validated files are removed below.
  }
  if (!ownedProcess) {
    rmSync(pointerPath, { force: true });
    rmSync(runtimeRoot, { force: true, recursive: true });
    return;
  }
  try {
    process.kill(state.pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  for (let attempt = 0; attempt < 50 && existsSync(pointerPath); attempt += 1) {
    await delay(100);
  }
  if (!existsSync(pointerPath)) return;
  rmSync(pointerPath, { force: true });
  rmSync(runtimeRoot, { force: true, recursive: true });
}
