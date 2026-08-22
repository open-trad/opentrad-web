#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { isPathWithin, sanitizeRelative } from "./release-utils.mjs";

const execFileAsync = promisify(execFile);
const PRODUCTION_ALLOWLIST = Object.freeze([
  "/opt/opentrad",
  "/run/opentrad",
  "/var/lib/opentrad",
  "/var/lib/docker/volumes",
  "/var/log/nginx",
  "/var/log/opentrad",
]);

class InspectionError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.exitCode = 78;
  }
}

async function regularFiles(root) {
  const files = [];
  const visit = async (path) => {
    const entries = await readdir(path, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const candidate = join(path, entry.name);
      if (entry.isSymbolicLink()) throw new InspectionError("PAUSE_PRIVACY:SYMLINK_REJECTED");
      if (entry.isDirectory()) await visit(candidate);
      else if (entry.isFile()) files.push(candidate);
      else throw new InspectionError("PAUSE_PRIVACY:ENTRY_UNREADABLE");
    }
  };
  const info = await stat(root);
  if (info.isDirectory()) await visit(root);
  else if (info.isFile()) files.push(root);
  else throw new InspectionError("PAUSE_PRIVACY:ROOT_UNREADABLE");
  return files;
}

export async function scanReadable(readable, markers, path, kind) {
  const encoded = markers.map((marker) => ({ ...marker, bytes: Buffer.from(marker.value) }));
  const overlap = Math.max(...encoded.map((marker) => marker.bytes.length), 1) - 1;
  const matched = new Set();
  let tail = Buffer.alloc(0);
  for await (const chunk of readable) {
    const window = tail.length === 0 ? chunk : Buffer.concat([tail, chunk]);
    for (const marker of encoded) {
      if (!matched.has(marker.id) && window.includes(marker.bytes)) matched.add(marker.id);
    }
    tail = overlap === 0 ? Buffer.alloc(0) : window.subarray(Math.max(0, window.length - overlap));
  }
  return encoded
    .filter((marker) => matched.has(marker.id))
    .map((marker) => ({ kind, markerId: marker.id, path }));
}

export async function scanFile(file, markers, root, kind) {
  return scanReadable(
    createReadStream(file, { highWaterMark: 64 * 1024 }),
    markers,
    sanitizeRelative(file, root),
    kind,
  );
}

async function scanSqliteDump(path, markers, root, kind) {
  const integrity = await execFileAsync("sqlite3", [path, "PRAGMA integrity_check;"]);
  if (integrity.stdout.trim() !== "ok") {
    throw new InspectionError("PAUSE_PRIVACY:SQLITE_INTEGRITY_FAILED");
  }
  const child = spawn("sqlite3", [path, ".dump"], {
    killSignal: "SIGKILL",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 120_000,
  });
  const completion = new Promise((resolveCompletion, rejectCompletion) => {
    child.once("error", rejectCompletion);
    child.once("close", (code) => {
      if (code === 0) resolveCompletion();
      else rejectCompletion(new Error("sqlite dump failed"));
    });
  });
  try {
    const [findings] = await Promise.all([
      scanReadable(child.stdout, markers, sanitizeRelative(path, root), `${kind}-sqlite-dump`),
      completion,
    ]);
    return findings;
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
}

function validateMarkers(markers) {
  if (!Array.isArray(markers) || markers.length === 0) {
    throw new InspectionError("PAUSE_PRIVACY:MARKERS_REQUIRED");
  }
  const identifiers = new Set();
  return markers.map((marker) => {
    if (
      marker === null ||
      typeof marker !== "object" ||
      typeof marker.id !== "string" ||
      !/^[a-z0-9][a-z0-9_-]{0,31}$/i.test(marker.id) ||
      identifiers.has(marker.id) ||
      typeof marker.value !== "string" ||
      marker.value.length < 8 ||
      marker.value.length > 512
    ) {
      throw new InspectionError("PAUSE_PRIVACY:MARKER_INVALID");
    }
    identifiers.add(marker.id);
    return Object.freeze({ id: marker.id, value: marker.value });
  });
}

export async function inspectPrivacy({ roots, markers, allowlistedRoots = PRODUCTION_ALLOWLIST }) {
  const checkedMarkers = validateMarkers(markers);
  if (!Array.isArray(roots) || roots.length === 0 || !Array.isArray(allowlistedRoots)) {
    throw new InspectionError("PAUSE_PRIVACY:ROOTS_REQUIRED");
  }
  const canonicalAllowlist = await Promise.all(
    allowlistedRoots.map(async (path) => {
      try {
        return await realpath(path);
      } catch {
        return resolve(path);
      }
    }),
  );
  const findings = [];
  let inspectedFiles = 0;
  for (const root of roots) {
    if (
      root === null ||
      typeof root !== "object" ||
      typeof root.kind !== "string" ||
      !/^[a-z0-9][a-z0-9_-]{0,31}$/i.test(root.kind) ||
      typeof root.path !== "string" ||
      root.path.length === 0
    ) {
      throw new InspectionError("PAUSE_PRIVACY:ROOT_INVALID");
    }
    let canonicalRoot;
    try {
      canonicalRoot = await realpath(root.path);
    } catch {
      throw new InspectionError("PAUSE_PRIVACY:ROOT_UNINSPECTABLE");
    }
    if (!canonicalAllowlist.some((allowed) => isPathWithin(canonicalRoot, allowed))) {
      throw new InspectionError("PAUSE_PRIVACY:ROOT_OUTSIDE_ALLOWLIST");
    }
    const files = await regularFiles(canonicalRoot);
    if (root.mustBeEmpty && files.length > 0) {
      for (const file of files) {
        findings.push({
          kind: root.kind,
          markerId: "RESIDUE",
          path: sanitizeRelative(file, canonicalRoot),
        });
      }
    }
    for (const file of files) {
      inspectedFiles += 1;
      try {
        findings.push(...(await scanFile(file, checkedMarkers, canonicalRoot, root.kind)));
      } catch {
        throw new InspectionError("PAUSE_PRIVACY:FILE_UNREADABLE");
      }
      if (/\.(?:sqlite|sqlite3|db)$/i.test(file)) {
        try {
          findings.push(...(await scanSqliteDump(file, checkedMarkers, canonicalRoot, root.kind)));
        } catch (error) {
          if (error instanceof InspectionError) throw error;
          throw new InspectionError("PAUSE_PRIVACY:SQLITE_UNINSPECTABLE");
        }
      }
    }
  }
  findings.sort((left, right) =>
    `${left.kind}:${left.path}:${left.markerId}`.localeCompare(
      `${right.kind}:${right.path}:${right.markerId}`,
    ),
  );
  return Object.freeze({
    findings: Object.freeze(findings),
    inspectedFiles,
    ok: findings.length === 0,
  });
}

export function productionRootDescriptors({ authVolume, captureRoot, jobVolume }) {
  return [
    { kind: "auth-database", path: authVolume },
    { kind: "job-tmpfs", path: jobVolume, mustBeEmpty: true },
    { kind: "nginx-log", path: "/var/log/nginx" },
    { kind: "release", path: "/opt/opentrad/releases" },
    { kind: "baseline", path: "/opt/opentrad/baselines" },
    { kind: "backup", path: "/opt/opentrad/backups" },
    { kind: "acceptance", path: "/opt/opentrad/reports" },
    { kind: "container-journal", path: captureRoot },
  ];
}

async function volumeRoot(name) {
  try {
    const { stdout } = await execFileAsync("docker", [
      "volume",
      "inspect",
      name,
      "--format",
      "{{.Mountpoint}}",
    ]);
    if (!stdout.trim()) throw new Error("empty");
    return stdout.trim();
  } catch {
    throw new InspectionError("PAUSE_PRIVACY:VOLUME_UNINSPECTABLE");
  }
}

async function captureCommand(path, command, args) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
    });
    await writeFile(path, Buffer.concat([stdout, stderr]), { mode: 0o600 });
  } catch {
    throw new InspectionError("PAUSE_PRIVACY:REMOTE_CAPTURE_FAILED");
  }
}

export async function runProductionProfile(markers) {
  const captureRoot = await mkdtemp("/run/opentrad/privacy-scan-");
  try {
    for (const name of ["opentrad-api-1", "opentrad-worker-1", "opentrad-clamav-1"]) {
      await captureCommand(join(captureRoot, `${name}.log`), "docker", ["logs", name]);
    }
    await captureCommand(join(captureRoot, "nginx-journal.log"), "journalctl", [
      "--unit=nginx",
      "--since=-24h",
      "--no-pager",
      "--output=short-iso",
    ]);
    return await inspectPrivacy({
      markers,
      roots: productionRootDescriptors({
        authVolume: await volumeRoot("opentrad_auth_data"),
        captureRoot,
        jobVolume: await volumeRoot("opentrad_job_ram"),
      }),
    });
  } finally {
    await rm(captureRoot, { force: true, recursive: true });
  }
}

async function readDescriptor(variable) {
  const raw = process.env[variable];
  if (!/^[3-9]\d*$/.test(raw ?? ""))
    throw new InspectionError(`PAUSE_PRIVACY:${variable}_REQUIRED`);
  return JSON.parse(await readFile(`/dev/fd/${raw}`, "utf8"));
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "opentrad-release-fixture-"));
  try {
    await writeFile(join(root, "safe.log"), "fixture contains no private marker\n");
    return await inspectPrivacy({
      roots: [{ kind: "fixture", path: root }],
      markers: [
        { id: "filename", value: "PRIVATE-FILENAME-2cc97440" },
        { id: "body", value: "PRIVATE-BODY-dcf03c83" },
        { id: "metadata", value: "PRIVATE-METADATA-83c96787" },
      ],
      allowlistedRoots: [root],
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function main() {
  try {
    const args = process.argv.slice(2);
    let result;
    if (args.length === 1 && args[0] === "--fixture-mode") result = await fixture();
    else if (
      args.length === 4 &&
      args[0] === "--remote-profile" &&
      args[1] === "production" &&
      args[2] === "--markers-fd" &&
      /^[3-9]\d*$/.test(args[3])
    ) {
      result = await runProductionProfile(JSON.parse(await readFile(`/dev/fd/${args[3]}`, "utf8")));
    } else if (args.length === 0) {
      result = await inspectPrivacy({
        roots: await readDescriptor("OPENTRAD_PRIVACY_ROOTS_FD"),
        markers: await readDescriptor("OPENTRAD_PRIVACY_MARKERS_FD"),
      });
    } else throw new InspectionError("PAUSE_PRIVACY:ARGUMENT_INVALID");
    if (!result.ok) {
      for (const finding of result.findings) {
        process.stderr.write(`PRIVACY_LEAK:${finding.kind}:${finding.path}:${finding.markerId}\n`);
      }
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`PRIVACY_OK:${result.inspectedFiles}\n`);
  } catch (error) {
    const code = error?.code?.startsWith?.("PAUSE_")
      ? error.code
      : "PAUSE_PRIVACY:INSPECTION_FAILED";
    process.stderr.write(`${code}\n`);
    process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 78;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
