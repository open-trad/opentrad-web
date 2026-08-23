import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = new URL("../../", import.meta.url);
const script = new URL("infra/deploy/run-acceptance.sh", repositoryRoot).pathname;
const sha = "0123456789abcdef0123456789abcdef01234567";

async function executable(path, body) {
  await writeFile(path, body, { mode: 0o755 });
  await chmod(path, 0o755);
}

test("formal acceptance requires deployment, canary, load, privacy, and unchanged baseline evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "opentrad-acceptance-test-"));
  const libexec = join(root, "libexec");
  const release = join(libexec, "release");
  const reports = join(root, "reports");
  const baselines = join(root, "baselines");
  await mkdir(release, { recursive: true });
  await mkdir(reports);
  await mkdir(baselines);
  await writeFile(join(reports, `${sha}.json`), JSON.stringify({ deployed: true, sourceSha: sha }));
  await writeFile(join(reports, `canary-${sha}.json`), JSON.stringify({ ok: true }));
  await writeFile(
    join(reports, `markers-${sha}.json`),
    JSON.stringify([{ id: "body", value: "PRIVATE-BODY-fixture" }]),
    { mode: 0o600 },
  );
  await writeFile(join(baselines, `before-${sha}.json`), JSON.stringify({ latencyP95: {} }));

  await executable(
    join(libexec, "build-load-profile.mjs"),
    `import { writeFileSync } from "node:fs"; writeFileSync(process.argv[3], '{"existingServices":[]}\\n');\n`,
  );
  await executable(join(release, "load-smoke.mjs"), `process.stdout.write('{"ok":true}\\n');\n`);
  await executable(
    join(release, "privacy-sentinel.mjs"),
    `import { existsSync, readFileSync } from "node:fs";
if (existsSync(process.env.OPENTRAD_ROOT + "/reports/markers-${sha}.json")) process.exit(91);
const fd = process.argv.at(-1);
const markers = JSON.parse(readFileSync("/dev/fd/" + fd, "utf8"));
if (markers[0]?.id !== "body") process.exit(92);
`,
  );
  await executable(
    join(release, "post-deploy-report.mjs"),
    `import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
writeFileSync(args[5], JSON.stringify({accepted:true,gates:{baseline:true,canary:true,load:true,privacy:true},schemaVersion:1,sourceSha:args[0]})+'\\n');\n`,
  );
  await executable(
    join(libexec, "capture-baseline.sh"),
    `#!/bin/sh
set -eu
test "$1" = acceptance
printf '%s\\n' '{"latencyP95":{}}' >"$OPENTRAD_ROOT/baselines/acceptance.json"
`,
  );
  await executable(join(libexec, "compare-baseline.mjs"), "process.stdout.write('[]\\n');\n");

  const { stdout } = await execFileAsync("sh", [script, sha], {
    env: {
      ...process.env,
      OPENTRAD_LIBEXEC: libexec,
      OPENTRAD_ROOT: root,
      OPENTRAD_TEST_MODE: "1",
    },
  });
  assert.match(stdout, new RegExp(`ACCEPTANCE_OK:${sha}`));
  const report = JSON.parse(await readFile(join(reports, `acceptance-${sha}.json`), "utf8"));
  assert.equal(report.accepted, true);
  assert.deepEqual(report.gates, { baseline: true, canary: true, load: true, privacy: true });
  assert.deepEqual(JSON.parse(await readFile(join(reports, `markers-${sha}.json`), "utf8")), [
    { id: "body", value: "PRIVATE-BODY-fixture" },
  ]);
});

test("formal acceptance fails closed before load when deployment evidence is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "opentrad-acceptance-missing-"));
  const libexec = join(root, "libexec");
  await mkdir(libexec);
  await mkdir(join(root, "reports"));
  await mkdir(join(root, "baselines"));
  await assert.rejects(
    execFileAsync("sh", [script, sha], {
      env: {
        ...process.env,
        OPENTRAD_LIBEXEC: libexec,
        OPENTRAD_ROOT: root,
        OPENTRAD_TEST_MODE: "1",
      },
    }),
    (error) => error.code === 78 && /PAUSE_ACCEPTANCE:EVIDENCE_MISSING/u.test(error.stderr),
  );
});

test("formal acceptance exposes only sanitized load failure codes", async () => {
  const root = await mkdtemp(join(tmpdir(), "opentrad-acceptance-load-failure-"));
  const libexec = join(root, "libexec");
  const release = join(libexec, "release");
  const reports = join(root, "reports");
  const baselines = join(root, "baselines");
  await mkdir(release, { recursive: true });
  await mkdir(reports);
  await mkdir(baselines);
  await writeFile(join(reports, `${sha}.json`), JSON.stringify({ deployed: true, sourceSha: sha }));
  await writeFile(join(reports, `canary-${sha}.json`), JSON.stringify({ ok: true }));
  await writeFile(join(reports, `markers-${sha}.json`), JSON.stringify([]), { mode: 0o600 });
  await writeFile(join(baselines, `before-${sha}.json`), JSON.stringify({ latencyP95: {} }));
  await executable(
    join(libexec, "build-load-profile.mjs"),
    `import { writeFileSync } from "node:fs"; writeFileSync(process.argv[3], '{"existingServices":[]}\\n');\n`,
  );
  await executable(
    join(release, "load-smoke.mjs"),
    `process.stdout.write('{"failures":["QUEUE_LIMIT"],"ok":false,"secret":"PRIVATE-load-secret"}\\n'); process.exitCode = 1;\n`,
  );

  await assert.rejects(
    execFileAsync("sh", [script, sha], {
      env: {
        ...process.env,
        OPENTRAD_LIBEXEC: libexec,
        OPENTRAD_ROOT: root,
        OPENTRAD_TEST_MODE: "1",
      },
    }),
    (error) =>
      error.code === 78 &&
      /\{"failures":\["QUEUE_LIMIT"\]\}/u.test(error.stderr) &&
      /PAUSE_ACCEPTANCE:LOAD_FAILED/u.test(error.stderr) &&
      !/PRIVATE-load-secret/u.test(error.stderr),
  );
});
