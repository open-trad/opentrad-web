import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const canaryScript = path.join(repositoryRoot, "infra/deploy/run-canary.sh");
const releaseSha = "0123456789abcdef0123456789abcdef01234567";
const expectedOrigin = "https://opentrad.dns.army";

async function executable(file, body) {
  await writeFile(file, body);
  await chmod(file, 0o755);
}

function curlCommands(source) {
  const commands = [];
  let current = "";
  for (const line of source.split("\n")) {
    if (current.length === 0 && !line.includes("curl ")) continue;
    current += `${current.length === 0 ? "" : "\n"}${line}`;
    if (!line.trimEnd().endsWith("\\")) {
      commands.push(current);
      current = "";
    }
  }
  return commands;
}

test("every canary mutation carries the exact production origin boundary headers", async () => {
  const source = await readFile(canaryScript, "utf8");
  const mutations = curlCommands(source).filter(
    (command) => command.includes("--data-binary") || command.includes("--form"),
  );

  assert.equal(mutations.length, 4);
  for (const command of mutations) {
    assert.match(command, /--header "origin: \$origin"/u);
    assert.match(command, /--header 'sec-fetch-site: same-origin'/u);
  }
});

test("canary privacy checks use the uploaded marker set across live SQLite files", async () => {
  const source = await readFile(canaryScript, "utf8");
  for (const suffix of ["opentrad.sqlite", "opentrad.sqlite-wal", "opentrad.sqlite-shm"]) {
    assert.match(
      source,
      new RegExp(`grep -aFq -f "\\$runtime/marker-values\\.txt"[^\\n]*${suffix}`),
    );
  }
  const scrub = "PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);";
  const scrubIndex = source.indexOf(scrub);
  assert.notEqual(scrubIndex, -1);
  assert.ok(scrubIndex < source.indexOf("marker_report_temp=$(mktemp"));
  assert.match(source, /install -d -o root -g opentrad-deploy -m 0750 "\$report_directory"/u);
  assert.match(source, /chown root:root "\$marker_report_temp" "\$canary_report_temp"/u);
});

test("the real canary script sends the origin boundary headers on every mutation", async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "opentrad-canary-origin-"));
  const binaryDirectory = path.join(fixture, "bin");
  const opentradRoot = path.join(fixture, "opentrad");
  const database = path.join(fixture, "opentrad.sqlite");
  const mutationLog = path.join(fixture, "mutations.jsonl");
  await mkdir(binaryDirectory);
  await writeFile(database, "");
  await executable(path.join(binaryDirectory, "sleep"), "#!/bin/sh\nexit 0\n");
  await executable(path.join(binaryDirectory, "sqlite3"), "#!/bin/sh\nexit 0\n");
  await executable(
    path.join(binaryDirectory, "docker"),
    `#!/bin/sh\nset -eu\nif test "\${1:-}" = volume; then printf '%s\\n' "$OPENTRAD_TEST_DATABASE"; fi\n`,
  );
  await executable(path.join(binaryDirectory, "journalctl"), "#!/bin/sh\nexit 0\n");
  await executable(
    path.join(binaryDirectory, "curl"),
    `#!/usr/bin/env node
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const values = (name) => args.flatMap((value, index) => value === name ? [args[index + 1]] : []);
const headers = values("--header");
const url = args.find((value) => value?.startsWith("https://"));
const output = values("--output").at(-1);
const dumpHeader = values("--dump-header").at(-1);
const cookieJar = values("--cookie-jar").at(-1);
const writeOut = values("--write-out").at(-1);
const mutation = args.includes("--data-binary") || args.includes("--form");
if (!url) process.exit(91);
if (mutation) {
  appendFileSync(process.env.OPENTRAD_TEST_MUTATIONS, JSON.stringify({
    fetchSite: headers.includes("sec-fetch-site: same-origin"),
    origin: headers.includes("origin: ${expectedOrigin}"),
    url,
  }) + "\\n");
  if (!headers.includes("origin: ${expectedOrigin}") || !headers.includes("sec-fetch-site: same-origin")) {
    process.exit(90);
  }
}
if (cookieJar) writeFileSync(cookieJar, "cookie");
const pathname = new URL(url).pathname;
if (pathname === "/api/v1/jobs") {
  const runtimeRoot = path.join(process.env.OPENTRAD_ROOT, "run");
  const runtimeName = readdirSync(runtimeRoot).find((name) => name.startsWith("opentrad-canary."));
  const markers = JSON.parse(readFileSync(path.join(runtimeRoot, runtimeName, "markers.json"), "utf8"));
  const marker = (id) => markers.find((entry) => entry.id === id)?.value;
  const form = values("--form").at(-1) ?? "";
  const metadata = headers.find((value) => value.startsWith("x-opentrad-job-request: ")) ?? "";
  const body = readFileSync(0, "utf8");
  if (!form.includes(marker("filename")) || !metadata.includes(marker("metadata")) || !body.includes(marker("body"))) {
    process.exit(92);
  }
}
if (dumpHeader) {
  const html = pathname === "/" || pathname === "/templates";
  const result = pathname.endsWith("/result");
  writeFileSync(dumpHeader, result
    ? "content-type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\\n"
    : html
      ? "content-security-policy: default-src 'self'\\nstrict-transport-security: max-age=1\\ncontent-type: text/html\\ncache-control: no-store\\nx-opentrad-release: ${releaseSha}\\n"
      : "content-type: application/json\\n");
}
if (output && output !== "/dev/null") {
  let body = "{}";
  if (pathname === "/api/v1/jobs") body = '{"job":{"id":"12345678-1234-1234-1234-123456789abc"}}';
  if (pathname === "/api/v1/jobs/12345678-1234-1234-1234-123456789abc") body = '{"job":{"status":"succeeded"}}';
  if (pathname.endsWith("/result")) body = "PK";
  writeFileSync(output, body);
}
if (writeOut === "%{url_effective}") process.stdout.write(url);
if (writeOut === "%{http_code}") {
  if (pathname === "/api/v1/register") process.stdout.write("201");
  else if (pathname === "/api/auth/delete-user") process.stdout.write("204");
  else if (pathname.endsWith("/result")) process.stdout.write("409");
  else process.stdout.write("200");
}
`,
  );

  const result = spawnSync("sh", [canaryScript, releaseSha], {
    encoding: "utf8",
    env: {
      ...process.env,
      OPENTRAD_TEST_DATABASE: fixture,
      OPENTRAD_TEST_MUTATIONS: mutationLog,
      OPENTRAD_ROOT: opentradRoot,
      OPENTRAD_TEST_MODE: "1",
      PATH: `${binaryDirectory}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`CANARY_OK:${releaseSha}`));
  const reports = path.join(opentradRoot, "reports");
  const canaryReportPath = path.join(reports, `canary-${releaseSha}.json`);
  const markerReportPath = path.join(reports, `markers-${releaseSha}.json`);
  assert.deepEqual(JSON.parse(await readFile(canaryReportPath, "utf8")), {
    ok: true,
    sourceSha: releaseSha,
  });
  const markerReport = JSON.parse(await readFile(markerReportPath, "utf8"));
  assert.deepEqual(
    markerReport.map((marker) => marker.id),
    ["filename", "body", "metadata"],
  );
  assert.equal(new Set(markerReport.map((marker) => marker.value)).size, 3);
  for (const marker of markerReport) {
    assert.match(marker.value, /^[A-Za-z0-9_.-]{8,512}$/u);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(marker.value));
  }
  assert.equal((await stat(canaryReportPath)).mode & 0o777, 0o600);
  assert.equal((await stat(markerReportPath)).mode & 0o777, 0o600);
  assert.deepEqual((await readdir(reports)).sort(), [
    `canary-${releaseSha}.json`,
    `markers-${releaseSha}.json`,
  ]);
  const mutations = (await readFile(mutationLog, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(mutations.length, 4);
  for (const mutation of mutations) {
    assert.equal(mutation.origin, true);
    assert.equal(mutation.fetchSite, true);
  }
});
