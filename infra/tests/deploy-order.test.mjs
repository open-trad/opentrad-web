import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const deployScript = path.join(repositoryRoot, "infra/deploy/deploy-release.sh");
const releaseSha = "0123456789abcdef0123456789abcdef01234567";

async function executable(file, body) {
  await writeFile(file, `#!/bin/sh\nset -eu\n${body}\n`);
  await chmod(file, 0o755);
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "opentrad-deploy-test-"));
  const binaryDirectory = path.join(root, "bin");
  const libexec = path.join(root, "libexec");
  const releaseDirectory = path.join(root, "releases", releaseSha);
  const log = path.join(root, "commands.log");
  await mkdir(path.join(releaseDirectory, "infra"), { recursive: true });
  await mkdir(path.join(libexec, "release"), { recursive: true });
  await mkdir(path.join(root, "baselines"), { recursive: true });
  await mkdir(binaryDirectory, { recursive: true });
  await mkdir(libexec, { recursive: true });
  await writeFile(path.join(releaseDirectory, "infra/compose.prod.yml"), "services: {}\n");
  await mkdir(path.join(releaseDirectory, "infra/nginx"), { recursive: true });
  await writeFile(
    path.join(releaseDirectory, "infra/nginx/opentrad.conf"),
    'server { set $opentrad_release "REPLACE_WITH_EXACT_RELEASE_SHA"; }\n',
  );
  await writeFile(
    path.join(releaseDirectory, "infra/nginx/opentrad-security-headers.conf"),
    "add_header X-Content-Type-Options nosniff always;\n",
  );
  await writeFile(path.join(releaseDirectory, "release-manifest.json"), "{}\n");

  const logger = 'printf "%s\\n" "$1" >>"$OPENTRAD_COMMAND_LOG"';
  await executable(
    path.join(binaryDirectory, "docker"),
    `case "$*" in
  "compose "*" config --quiet") ${logger.replace("$1", "compose-config")} ;;
  "compose "*" --dry-run up -d") ${logger.replace("$1", "compose-dry-run")} ;;
  "compose "*" pull") ${logger.replace("$1", "image-pull")} ;;
  "image inspect ghcr.io/open-trad/opentrad-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") ${logger.replace("$1", "image-inspect-api")} ;;
  "image inspect ghcr.io/open-trad/opentrad-worker@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb") ${logger.replace("$1", "image-inspect-worker")} ;;
  "image inspect clamav/clamav@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc") ${logger.replace("$1", "image-inspect-clamav")} ;;
  "volume create opentrad_auth_data") ${logger.replace("$1", "volume-create")} ;;
  "run --rm --network none --user 0:0 --entrypoint /bin/sh --mount type=volume,src=opentrad_auth_data,dst=/var/lib/opentrad "*) ${logger.replace("$1", "volume-init")} ;;
  "volume inspect "*) exit 0 ;;
  "compose "*" run --rm --no-deps api "*" --dry-run") ${logger.replace("$1", "migration-dry-run")} ;;
  "compose "*" run --rm --no-deps api "*" --apply") ${logger.replace("$1", "migration-apply")} ;;
  "compose "*" rm --force --stop api worker clamav") ${logger.replace("$1", "compose-remove")} ;;
  "compose "*" up -d --pull never --wait --wait-timeout 180") ${logger.replace("$1", "compose-up")} ;;
  *) printf "unexpected docker command: %s\\n" "$*" >&2; exit 91 ;;
esac`,
  );
  await executable(path.join(binaryDirectory, "curl"), `${logger.replace("$1", "health-wait")}`);
  await executable(path.join(binaryDirectory, "nginx"), logger.replace("$1", "nginx-test"));
  await executable(path.join(binaryDirectory, "systemctl"), logger.replace("$1", "nginx-reload"));

  await executable(
    path.join(libexec, "check-external-gates.sh"),
    logger.replace("$1", "external-gates"),
  );
  await executable(
    path.join(libexec, "capture-baseline.sh"),
    `${logger.replace("$1", "baseline-$1")}
if test "$1" = before; then
  printf '{"containers":{},"listeners":[],"networks":[],"latencyP95":{}}\\n' >"$OPENTRAD_ROOT/baselines/before-$2.json"
else
  printf '{"containers":{},"listeners":[],"networks":[],"latencyP95":{}}\\n' >"$OPENTRAD_ROOT/baselines/after-$2.json"
fi`,
  );
  await executable(path.join(libexec, "run-canary.sh"), logger.replace("$1", "canary"));
  await executable(path.join(libexec, "cleanup-releases.sh"), logger.replace("$1", "cleanup"));
  await writeFile(
    path.join(libexec, "release/verify-manifest.mjs"),
    `import { appendFileSync, writeFileSync } from "node:fs";
appendFileSync(process.env.OPENTRAD_COMMAND_LOG, "manifest-verify\\n");
const index = process.argv.indexOf("--emit-compose-env");
if (index !== -1) writeFileSync(process.argv[index + 1], "OPENTRAD_API_IMAGE=ghcr.io/open-trad/opentrad-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\nOPENTRAD_WORKER_IMAGE=ghcr.io/open-trad/opentrad-worker@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\nOPENTRAD_CLAMAV_IMAGE=clamav/clamav@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\\n");
`,
  );
  await writeFile(
    path.join(libexec, "compare-baseline.mjs"),
    await readFile(path.join(repositoryRoot, "infra/deploy/compare-baseline.mjs")),
  );

  return { binaryDirectory, libexec, log, releaseDirectory, root };
}

function runDeploy(context, extraEnvironment = {}) {
  return spawnSync("sh", [deployScript, releaseSha], {
    encoding: "utf8",
    env: {
      ...process.env,
      OPENTRAD_COMMAND_LOG: context.log,
      OPENTRAD_LIBEXEC: context.libexec,
      OPENTRAD_NGINX_ROOT: path.join(context.root, "nginx"),
      OPENTRAD_ROOT: context.root,
      OPENTRAD_TEST_MODE: "1",
      PATH: `${context.binaryDirectory}:${process.env.PATH}`,
      ...extraEnvironment,
    },
  });
}

test("deploy follows the production operation order", async () => {
  const context = await fixture();
  const result = runDeploy(context);
  assert.equal(result.status, 0, result.stderr);
  const commands = (await readFile(context.log, "utf8")).trim().split("\n");
  assert.deepEqual(commands, [
    "external-gates",
    "baseline-before",
    "manifest-verify",
    "compose-config",
    "compose-dry-run",
    "image-pull",
    "image-inspect-api",
    "image-inspect-worker",
    "image-inspect-clamav",
    "volume-create",
    "volume-init",
    "migration-dry-run",
    "migration-apply",
    "image-inspect-api",
    "image-inspect-worker",
    "image-inspect-clamav",
    "compose-remove",
    "compose-up",
    "health-wait",
    "nginx-test",
    "nginx-reload",
    "canary",
    "baseline-after",
    "cleanup",
  ]);
  assert.equal(
    await readFile(path.join(context.root, "current"), "utf8").catch(() => "symlink"),
    "symlink",
  );
  assert.equal(
    JSON.parse(await readFile(path.join(context.root, "reports", `${releaseSha}.json`), "utf8"))
      .deployed,
    true,
  );
});

test("invalid SHA pauses before any command", async () => {
  const context = await fixture();
  const result = spawnSync("sh", [deployScript, "latest"], {
    encoding: "utf8",
    env: {
      ...process.env,
      OPENTRAD_COMMAND_LOG: context.log,
      OPENTRAD_LIBEXEC: context.libexec,
      OPENTRAD_NGINX_ROOT: path.join(context.root, "nginx"),
      OPENTRAD_ROOT: context.root,
      OPENTRAD_TEST_MODE: "1",
      PATH: `${context.binaryDirectory}:${process.env.PATH}`,
    },
  });
  assert.equal(result.status, 78);
  assert.match(result.stderr, /PAUSE_RELEASE:INVALID_SHA/u);
  assert.equal(await readFile(context.log, "utf8").catch(() => ""), "");
});

test("a failed canary prevents baseline comparison and cleanup", async () => {
  const context = await fixture();
  await executable(
    path.join(context.libexec, "run-canary.sh"),
    'printf "%s\\n" canary >>"$OPENTRAD_COMMAND_LOG"\nexit 23',
  );
  const result = runDeploy(context);
  assert.equal(result.status, 23);
  const commands = (await readFile(context.log, "utf8")).trim().split("\n");
  assert.equal(commands.at(-1), "canary");
  assert.ok(!commands.includes("baseline-after"));
  assert.ok(!commands.includes("cleanup"));
  const report = JSON.parse(
    await readFile(path.join(context.root, "reports", `${releaseSha}.json`), "utf8"),
  );
  assert.equal(report.deployed, false);
  assert.equal(report.failedStage, "canary");
});

test("rollback and cleanup implementations forbid volume deletion and implicit restore", async () => {
  const rollback = await readFile(
    path.join(repositoryRoot, "infra/deploy/rollback-release.sh"),
    "utf8",
  );
  const cleanup = await readFile(
    path.join(repositoryRoot, "infra/deploy/cleanup-releases.sh"),
    "utf8",
  );
  assert.doesNotMatch(rollback, /down\s+-v|volume\s+(?:rm|prune)|\.restore/u);
  assert.doesNotMatch(cleanup, /docker\s+(?:system|volume)\s+prune/u);
  assert.match(cleanup, /trusted_verifier="\$libexec\/release\/verify-manifest\.mjs"/u);
  assert.doesNotMatch(cleanup, /join\(directory, "scripts\/release\/verify-manifest\.mjs"\)/u);
});

test("deploy and rollback inspect exact images and create from a clean container set", async () => {
  for (const script of ["deploy-release.sh", "rollback-release.sh"]) {
    const source = await readFile(path.join(repositoryRoot, "infra/deploy", script), "utf8");
    assert.match(source, /docker image inspect "\$image"/u, script);
    assert.match(source, /rm --force --stop api worker clamav/u, script);
    assert.match(source, /up -d --pull never --wait --wait-timeout 180/u, script);
    assert.doesNotMatch(source, /rm --force --stop (?:--volumes|-v)/u, script);
  }
});

test("deploy and rollback readiness preserve the public host boundary", async () => {
  for (const script of ["deploy-release.sh", "rollback-release.sh"]) {
    const source = await readFile(path.join(repositoryRoot, "infra/deploy", script), "utf8");
    assert.match(
      source,
      /curl --fail --silent --show-error --header 'Host: opentrad\.dns\.army'\s*\\\s*http:\/\/127\.0\.0\.1:13300\/api\/health\/ready/u,
      script,
    );
  }
});
