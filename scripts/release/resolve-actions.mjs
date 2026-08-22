#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWrite } from "./release-utils.mjs";

const allowed = Object.freeze({
  "actions/attest-build-provenance": "v2.4.0",
  "actions/checkout": "v4.2.2",
  "actions/configure-pages": "v5.0.0",
  "actions/deploy-pages": "v4.0.5",
  "actions/setup-node": "v4.4.0",
  "actions/upload-artifact": "v4.6.2",
  "actions/upload-pages-artifact": "v3.0.1",
  "anchore/sbom-action": "v0.20.5",
  "aquasecurity/trivy-action": "v0.33.1",
  "docker/build-push-action": "v6.18.0",
  "docker/login-action": "v3.4.0",
  "docker/setup-buildx-action": "v3.11.1",
  "sigstore/cosign-installer": "v4.1.2",
});

function pause(action) {
  const error = new Error(`PAUSE_CI:ACTION_PIN_UNRESOLVED:${action.replaceAll("/", "-")}`);
  error.exitCode = 78;
  throw error;
}

async function github(path) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "opentrad-action-resolver",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com${path}`, { headers, redirect: "error" });
  if (!response.ok) throw new Error(`GitHub API ${response.status}`);
  return response.json();
}

async function peeledCommit(action, tag) {
  const repository = await github(`/repos/${action}`);
  if (repository.full_name?.toLowerCase() !== action.toLowerCase()) pause(action);
  const reference = await github(`/repos/${action}/git/ref/tags/${encodeURIComponent(tag)}`);
  let object = reference.object;
  for (let depth = 0; depth < 5 && object?.type === "tag"; depth += 1) {
    object = (await github(`/repos/${action}/git/tags/${object.sha}`)).object;
  }
  if (object?.type !== "commit" || !/^[a-f0-9]{40}$/.test(object.sha ?? "")) pause(action);
  return object.sha;
}

function actionFromUse(value) {
  if (value.startsWith("./") || value.startsWith("docker://")) return undefined;
  const segments = value.split("@")[0].split("/");
  return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : undefined;
}

async function main() {
  try {
    const directory = resolve(".github/workflows");
    const names = (await readdir(directory)).filter((name) => /\.ya?ml$/.test(name)).sort();
    const files = await Promise.all(
      names.map(async (name) => ({
        path: join(directory, name),
        text: await readFile(join(directory, name), "utf8"),
      })),
    );
    const required = new Set();
    for (const file of files) {
      for (const match of file.text.matchAll(/uses:\s*([^\s#]+)/g)) {
        const action = actionFromUse(match[1]);
        if (!action) continue;
        if (!(action in allowed)) pause(action);
        required.add(action);
      }
    }
    const pins = new Map();
    for (const action of [...required].sort()) {
      try {
        pins.set(action, await peeledCommit(action, allowed[action]));
      } catch {
        pause(action);
      }
    }
    const rewritten = files.map((file) => ({
      ...file,
      next: file.text.replace(/uses:\s*([^\s#]+)/g, (full, value) => {
        const action = actionFromUse(value);
        if (!action) return full;
        return `uses: ${value.split("@")[0]}@${pins.get(action)}`;
      }),
    }));
    for (const file of rewritten) await atomicWrite(file.path, file.next, 0o644);
    process.stdout.write(`ACTION_PINS_OK:${rewritten.length}\n`);
  } catch (error) {
    process.stderr.write(
      `${error?.message?.startsWith?.("PAUSE_") ? error.message : "PAUSE_CI:ACTION_RESOLUTION_FAILED"}\n`,
    );
    process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 78;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
