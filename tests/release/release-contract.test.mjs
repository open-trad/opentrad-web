import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { canonicalJson, sha256File, sha256Tree } from "../../scripts/release/release-utils.mjs";

const root = new URL("../../", import.meta.url);
const execFileAsync = promisify(execFile);

const validManifest = Object.freeze({
  schemaVersion: 3,
  sourceSha: "a".repeat(40),
  webSha256: "b".repeat(64),
  infraSha256: "6".repeat(64),
  releaseScriptsSha256: "7".repeat(64),
  apiImage: `ghcr.io/open-trad/opentrad-api@sha256:${"c".repeat(64)}`,
  workerImage: `ghcr.io/open-trad/opentrad-worker@sha256:${"d".repeat(64)}`,
  clamavImage: `clamav/clamav@sha256:${"e".repeat(64)}`,
  clamavSignaturePolicy: "upstream-unsigned-digest-pinned-trivy-gated",
  evidenceSha256: {
    apiSbom: "f".repeat(64),
    clamavSbom: "8".repeat(64),
    trivyApi: "1".repeat(64),
    trivyClamav: "9".repeat(64),
    trivyWorker: "2".repeat(64),
    webSbom: "3".repeat(64),
    workerSbom: "4".repeat(64),
  },
  createdAt: "2026-08-19T00:00:00.000Z",
});

test("release manifest schema is strict and content addressed", async () => {
  const { ReleaseManifestSchema } = await import(
    new URL("scripts/release/verify-manifest.mjs", root)
  );
  assert.deepEqual(ReleaseManifestSchema.parse(validManifest), validManifest);
  assert.throws(() => ReleaseManifestSchema.parse({ ...validManifest, sourceSha: "main" }));
  assert.throws(() => ReleaseManifestSchema.parse({ ...validManifest, unreviewed: true }));
});

test("attestation verification uses one compatible signer identity policy", async () => {
  const verifier = await readFile(new URL("scripts/release/verify-manifest.mjs", root), "utf8");
  const verifyAttestation = verifier.slice(
    verifier.indexOf("async function verifyAttestation"),
    verifier.indexOf("async function verifyWebArchive"),
  );

  assert.match(verifyAttestation, /"--cert-identity-regex",\s*RELEASE_CERT_IDENTITY/);
  assert.match(verifyAttestation, /"--deny-self-hosted-runners"/);
  assert.doesNotMatch(verifyAttestation, /--signer-workflow/);
});

test("fixture verification emits compose env only after all local digests pass", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "opentrad-manifest-fixture-"));
  try {
    const web = join(fixture, "web");
    const infra = join(fixture, "infra");
    const releaseScripts = join(fixture, "scripts", "release");
    const evidence = {
      apiSbom: join(fixture, "sbom-api.spdx.json"),
      clamavSbom: join(fixture, "sbom-clamav.spdx.json"),
      trivyApi: join(fixture, "trivy-api.json"),
      trivyClamav: join(fixture, "trivy-clamav.json"),
      trivyWorker: join(fixture, "trivy-worker.json"),
      webSbom: join(fixture, "sbom-web.spdx.json"),
      workerSbom: join(fixture, "sbom-worker.spdx.json"),
    };
    const manifestPath = join(fixture, "release-manifest.json");
    const composeEnv = join(fixture, "compose.env");
    await mkdir(web);
    await mkdir(infra);
    await mkdir(releaseScripts, { recursive: true });
    await writeFile(join(web, "index.html"), "<!doctype html><title>fixture</title>\n");
    await writeFile(join(infra, "compose.yml"), "services: {}\n");
    await writeFile(join(releaseScripts, "verify.mjs"), "export {};\n");
    for (const file of Object.values(evidence)) await writeFile(file, "{}\n");
    const manifest = {
      ...validManifest,
      webSha256: await sha256Tree(web),
      infraSha256: await sha256Tree(infra),
      releaseScriptsSha256: await sha256Tree(releaseScripts),
      evidenceSha256: Object.fromEntries(
        await Promise.all(
          Object.entries(evidence).map(async ([kind, file]) => [kind, await sha256File(file)]),
        ),
      ),
    };
    await writeFile(manifestPath, canonicalJson(manifest));

    await execFileAsync(process.execPath, [
      new URL("scripts/release/verify-manifest.mjs", root).pathname,
      manifestPath,
      "--fixture-mode",
      "--web",
      web,
      "--infra",
      infra,
      "--release-scripts",
      releaseScripts,
      "--api-sbom",
      evidence.apiSbom,
      "--clamav-sbom",
      evidence.clamavSbom,
      "--trivy-api",
      evidence.trivyApi,
      "--trivy-clamav",
      evidence.trivyClamav,
      "--trivy-worker",
      evidence.trivyWorker,
      "--web-sbom",
      evidence.webSbom,
      "--worker-sbom",
      evidence.workerSbom,
      "--emit-compose-env",
      composeEnv,
    ]);
    assert.match(await readFile(composeEnv, "utf8"), /OPENTRAD_RELEASE_SHA=a{40}/);
    assert.equal((await stat(composeEnv)).mode & 0o777, 0o600);

    await writeFile(join(infra, "compose.yml"), "services:\n  changed: {}\n");
    await assert.rejects(
      execFileAsync(process.execPath, [
        new URL("scripts/release/verify-manifest.mjs", root).pathname,
        manifestPath,
        "--fixture-mode",
        "--web",
        web,
        "--infra",
        infra,
        "--release-scripts",
        releaseScripts,
        "--api-sbom",
        evidence.apiSbom,
        "--clamav-sbom",
        evidence.clamavSbom,
        "--trivy-api",
        evidence.trivyApi,
        "--trivy-clamav",
        evidence.trivyClamav,
        "--trivy-worker",
        evidence.trivyWorker,
        "--web-sbom",
        evidence.webSbom,
        "--worker-sbom",
        evidence.workerSbom,
      ]),
      (error) => error.stderr.includes("PAUSE_RELEASE:INFRA_DIGEST_MISMATCH"),
    );
    await writeFile(join(infra, "compose.yml"), "services: {}\n");

    await writeFile(join(web, "index.html"), "changed\n");
    const rejectedEnv = join(fixture, "rejected.env");
    await assert.rejects(
      execFileAsync(process.execPath, [
        new URL("scripts/release/verify-manifest.mjs", root).pathname,
        manifestPath,
        "--fixture-mode",
        "--web",
        web,
        "--infra",
        infra,
        "--release-scripts",
        releaseScripts,
        "--api-sbom",
        evidence.apiSbom,
        "--clamav-sbom",
        evidence.clamavSbom,
        "--trivy-api",
        evidence.trivyApi,
        "--trivy-clamav",
        evidence.trivyClamav,
        "--trivy-worker",
        evidence.trivyWorker,
        "--web-sbom",
        evidence.webSbom,
        "--worker-sbom",
        evidence.workerSbom,
        "--emit-compose-env",
        rejectedEnv,
      ]),
    );
    await assert.rejects(access(rejectedEnv));
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("all workflow actions are immutable and Pages is preview only", async () => {
  const paths = [
    ".github/workflows/ci.yml",
    ".github/workflows/pages.yml",
    ".github/workflows/release-images.yml",
    ".github/workflows/deploy-production.yml",
  ];
  for (const path of paths) {
    const yaml = await readFile(new URL(path, root), "utf8");
    for (const match of yaml.matchAll(/uses:\s*[^@\s]+@([^\s#]+)/g)) {
      assert.match(match[1], /^[a-f0-9]{40}$/, `${path} contains a floating action`);
    }
  }

  const pages = await readFile(new URL(".github/workflows/pages.yml", root), "utf8");
  assert.match(pages, /VITE_DEPLOYMENT_MODE:\s*preview/);
  assert.match(pages, /VITE_SERVER_API_ENABLED:\s*["']false["']/);
  assert.doesNotMatch(pages, /VITE_SERVER_API_ENABLED:\s*["']true["']/);
  assert.match(pages, /Prove preview has no production API endpoint/);

  const release = await readFile(new URL(".github/workflows/release-images.yml", root), "utf8");
  assert.match(release, /VITE_DEPLOYMENT_MODE:\s*production/);
  assert.match(release, /VITE_SERVER_API_ENABLED:\s*["']true["']/);
  assert.match(release, /release_sha/);
  assert.match(release, /REQUESTED_SHA.*GITHUB_SHA|GITHUB_SHA.*REQUESTED_SHA/s);
  assert.match(release, /merge-base --is-ancestor "\$REQUESTED_SHA" refs\/remotes\/origin\/main/);
  assert.match(release, /refs\/heads\/main/);
  assert.match(release, /trivy-clamav\.json/);
  assert.match(release, /sbom-clamav\.spdx\.json/);
  const apiBuild = release.slice(
    release.indexOf("Build and push API by source SHA"),
    release.indexOf("Build and push worker by source SHA"),
  );
  assert.match(apiBuild, /DEBIAN_IMAGE=\$\{\{ steps\.base-images\.outputs\.DEBIAN_IMAGE \}\}/);
  assert.match(apiBuild, /NODE_IMAGE=\$\{\{ steps\.base-images\.outputs\.NODE_IMAGE \}\}/);
  assert.match(release, /scripts\/release\/verify-trivy-policy\.mjs/);
  assert.match(release, /infra\/docker\/trivy-exceptions\.json/);
  assert.doesNotMatch(release, /\[inputs\.Results/);
  assert.match(release, /cosign/);
  assert.match(release, /attest/);

  const deploy = await readFile(new URL(".github/workflows/deploy-production.yml", root), "utf8");
  const verifyRelease = deploy.slice(
    deploy.indexOf("Verify hashes, signatures, and attestations before transfer"),
    deploy.indexOf("Install dedicated SSH material"),
  );
  const actionResolver = await readFile(
    new URL("scripts/release/resolve-actions.mjs", root),
    "utf8",
  );
  const cosignInstallerCommit = "6f9f17788090df1f26f669e9d70d6ae9567deba6";
  assert.match(release, new RegExp(`sigstore/cosign-installer@${cosignInstallerCommit}`));
  assert.match(deploy, new RegExp(`sigstore/cosign-installer@${cosignInstallerCommit}`));
  assert.match(actionResolver, /"sigstore\/cosign-installer": "v4\.1\.2"/);
  assert.doesNotMatch(deploy, /id-token:\s*write/);
  assert.match(deploy, /GITHUB_REF.*refs\/heads\/main|refs\/heads\/main.*GITHUB_REF/s);
  assert.match(deploy, /merge-base --is-ancestor "\$RELEASE_SHA" refs\/remotes\/origin\/main/);
  assert.match(deploy, /environment:\s*\n\s+name:\s*production/);
  assert.match(verifyRelease, /GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
  assert.match(deploy, /\^\[a-f0-9\]\{40\}\$/);
  assert.doesNotMatch(deploy, /git\s+checkout\s+(main|master)/);
  assert.match(deploy, /\.incoming-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}/);
  assert.match(deploy, /seal-release\.sh/);
  assert.match(deploy, /cleanup-incoming-release\.sh/);
  assert.match(deploy, /run-acceptance\.sh/);
  assert.match(deploy, /Run the fixed formal acceptance command[\s\S]*?timeout-minutes:\s*35/);
  assert.match(deploy, /ConnectTimeout=15/);
  assert.match(deploy, /ServerAliveInterval=15/);
  assert.match(deploy, /ServerAliveCountMax=3/);
  assert.match(deploy, /post-deploy-report\.mjs --verify-deployment/);
  assert.match(deploy, /post-deploy-report\.mjs --verify/);
  assert.doesNotMatch(deploy, /continue-on-error:\s*true/);
  assert.doesNotMatch(deploy, /\|\|\s*true/);
  assert.match(deploy, /if-no-files-found:\s*error/);
});

test("operator runbooks contain exact gates and decision points", async () => {
  const production = await readFile(new URL("docs/operations/production-runbook.md", root), "utf8");
  const rollback = await readFile(new URL("docs/operations/rollback-runbook.md", root), "utf8");
  const privacy = await readFile(new URL("docs/operations/privacy-runbook.md", root), "utf8");
  const combined = `${production}\n${rollback}\n${privacy}`;

  for (const required of [
    "https://opentrad.dns.army",
    "https://opentrad.dns.army/api/auth/callback/github",
    "check-external-gates.sh",
    "capture-baseline.sh",
    "--dry-run up -d",
    "deploy-release.sh",
    "rollback-release.sh",
    "privacy-sentinel.mjs",
    "PRAGMA integrity_check",
    "PAUSE_",
    "2026-12-02",
    "required reviewer",
    "self-review",
    "branch protection",
    "install-host-tools.sh infra/deploy/host-tools.lock",
    "/opt/opentrad/secrets",
    "four required files",
    "opentrad-api-1",
    "opentrad-worker-1",
    "--target https://opentrad.dns.army --profile-fd 3",
    "--remote-profile production --markers-fd 3",
  ]) {
    assert.ok(combined.includes(required), `missing runbook contract: ${required}`);
  }
  assert.match(combined, /canary.{0,80}(stop|pause|停止|暂停)/i);
  assert.match(combined, /load.{0,80}(stop|pause|停止|暂停)/i);
  assert.match(combined, /privacy.{0,80}(stop|pause|停止|暂停)/i);
  assert.match(combined, /must not.{0,100}(Docker|existing service)/i);
  assert.doesNotMatch(combined, /capture-baseline\.sh (?:manual-postflight|rollback-postflight)/);
  assert.doesNotMatch(combined, /docker (?:start|stop) opentrad_(?:api|worker)/);
  assert.doesNotMatch(privacy, /--unit=opentrad-(?:api|worker)/);
  assert.doesNotMatch(combined, /^docker (?:compose|ps|start|stop|volume)\b/gm);
  assert.match(
    privacy,
    /(filename, body, and metadata marker).{0,160}(real fixture).{0,80}(uploaded|upload)/is,
  );
  assert.match(privacy, /(must not|never).{0,120}(random|unuploaded).{0,120}marker/is);
});

test("CI installs pnpm before setup-node enables the pnpm cache", async () => {
  const workflow = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
  const jobs = workflow.split(/^ {2}[a-z][a-z-]+:\s*$/m).slice(1);
  const cachedJobs = jobs.filter((job) => /cache:\s*pnpm/.test(job));

  assert.ok(cachedJobs.length > 0, "expected at least one pnpm-cached CI job");
  for (const job of cachedJobs) {
    const pnpmSetup = job.indexOf("pnpm/action-setup@");
    const nodeSetup = job.indexOf("actions/setup-node@");
    assert.ok(pnpmSetup >= 0, "cached CI job must install pnpm explicitly");
    assert.ok(pnpmSetup < nodeSetup, "pnpm must exist before setup-node resolves its cache path");
  }
});

test("release installs pnpm before setup-node enables the pnpm cache", async () => {
  const workflow = await readFile(new URL(".github/workflows/release-images.yml", root), "utf8");
  const pnpmSetup = workflow.indexOf("pnpm/action-setup@");
  const nodeSetup = workflow.indexOf("actions/setup-node@");

  assert.ok(pnpmSetup >= 0, "release must install pnpm explicitly");
  assert.ok(pnpmSetup < nodeSetup, "pnpm must exist before setup-node resolves its cache path");
});
