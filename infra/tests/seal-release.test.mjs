import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = new URL("../../", import.meta.url);
const script = new URL("infra/deploy/seal-release.sh", root).pathname;
const cleanupScript = new URL("infra/deploy/cleanup-incoming-release.sh", root).pathname;
const sha = "0123456789abcdef0123456789abcdef01234567";

async function fixture() {
  const runtime = await mkdtemp(join(tmpdir(), "opentrad-seal-"));
  const staging = join(runtime, "incoming", `${sha}.incoming-123-2`);
  await mkdir(staging, { recursive: true });
  await mkdir(join(runtime, "releases"), { recursive: true });
  await writeFile(join(staging, "release-manifest.json"), "{}\n", { mode: 0o600 });
  await mkdir(join(staging, "infra"));
  await writeFile(join(staging, "infra", "compose.prod.yml"), "services: {}\n");
  return { runtime, staging };
}

test("root sealing atomically moves a regular release into a read-only root-owned tree", async () => {
  const current = await fixture();
  const { stdout } = await execFileAsync("sh", [script, sha, "123", "2"], {
    env: { ...process.env, OPENTRAD_ROOT: current.runtime, OPENTRAD_TEST_MODE: "1" },
  });
  assert.equal(stdout.trim(), `RELEASE_SEALED:${sha}`);
  const final = join(current.runtime, "releases", sha);
  assert.equal((await stat(final)).mode & 0o777, 0o555);
  assert.equal((await stat(join(final, "release-manifest.json"))).mode & 0o777, 0o444);
  assert.equal(await readFile(join(final, "release-manifest.json"), "utf8"), "{}\n");
  await assert.rejects(lstat(current.staging));
});

test("sealing rejects symlinks, hardlinks, invalid run ids, and an existing final release", async () => {
  const invalid = await fixture();
  await writeFile(join(invalid.staging, "payload"), "payload");
  await execFileAsync("ln", [
    join(invalid.staging, "payload"),
    join(invalid.staging, "payload-hardlink"),
  ]);
  await assert.rejects(
    execFileAsync("sh", [script, sha, "123", "2"], {
      env: { ...process.env, OPENTRAD_ROOT: invalid.runtime, OPENTRAD_TEST_MODE: "1" },
    }),
    (error) => error.code === 78 && /HARDLINK_REJECTED/u.test(error.stderr),
  );

  const badRun = await fixture();
  await assert.rejects(
    execFileAsync("sh", [script, sha, "../../bad", "2"], {
      env: { ...process.env, OPENTRAD_ROOT: badRun.runtime, OPENTRAD_TEST_MODE: "1" },
    }),
    (error) => error.code === 78 && /INVALID_RUN_ID/u.test(error.stderr),
  );

  const existing = await fixture();
  await mkdir(join(existing.runtime, "releases", sha));
  await chmod(join(existing.runtime, "releases", sha), 0o755);
  await assert.rejects(
    execFileAsync("sh", [script, sha, "123", "2"], {
      env: { ...process.env, OPENTRAD_ROOT: existing.runtime, OPENTRAD_TEST_MODE: "1" },
    }),
    (error) => error.code === 78 && /RELEASE_EXISTS/u.test(error.stderr),
  );
});

test("incoming cleanup removes only the validated run staging directory", async () => {
  const current = await fixture();
  const sibling = join(current.runtime, "incoming", `${sha}.incoming-123-3`);
  await mkdir(sibling);
  const { stdout } = await execFileAsync("sh", [cleanupScript, sha, "123", "2"], {
    env: { ...process.env, OPENTRAD_ROOT: current.runtime, OPENTRAD_TEST_MODE: "1" },
  });
  assert.equal(stdout.trim(), `INCOMING_CLEANED:${sha}`);
  await assert.rejects(lstat(current.staging));
  assert.equal((await stat(sibling)).isDirectory(), true);

  await assert.rejects(
    execFileAsync("sh", [cleanupScript, sha, "../123", "3"], {
      env: { ...process.env, OPENTRAD_ROOT: current.runtime, OPENTRAD_TEST_MODE: "1" },
    }),
    (error) => error.code === 78 && /INVALID_RUN_ID/u.test(error.stderr),
  );
});
