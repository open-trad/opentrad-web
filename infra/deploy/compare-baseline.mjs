import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const immutableExistingFields = Object.freeze([
  "containerId",
  "imageDigest",
  "publishedPorts",
  "networks",
  "restartCount",
  "state",
  "health",
]);

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function entries(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : [];
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function difference(name, field, expected, actual) {
  return { actual, expected, field, name };
}

function allowedOpenTradContainer(container) {
  const ports = array(container?.publishedPorts);
  const networks = array(container?.networks);
  return (
    ports.every((port) => port === "127.0.0.1:13300->3000/tcp") &&
    networks.every(
      (network) => typeof network === "string" && network.split(":", 1)[0].startsWith("opentrad_"),
    )
  );
}

export function compareExisting(before, after) {
  const differences = [];
  const beforeContainers = Object.fromEntries(entries(before?.containers));
  const afterContainers = Object.fromEntries(entries(after?.containers));
  for (const [name, expected] of Object.entries(beforeContainers)) {
    const actual = afterContainers[name];
    if (!actual) {
      differences.push(difference(name, "present", true, false));
      continue;
    }
    for (const field of immutableExistingFields) {
      if (!same(expected?.[field], actual?.[field])) {
        differences.push(difference(name, field, expected?.[field], actual?.[field]));
      }
    }
  }
  for (const [name, actual] of Object.entries(afterContainers)) {
    if (Object.hasOwn(beforeContainers, name)) continue;
    if (!name.startsWith("opentrad-") || !allowedOpenTradContainer(actual)) {
      differences.push(difference(name, "addition", "opentrad-scoped", "unscoped"));
    }
  }

  const beforeListeners = new Set(array(before?.listeners));
  for (const listener of array(after?.listeners)) {
    if (!beforeListeners.has(listener) && listener !== "127.0.0.1:13300") {
      differences.push(
        difference(String(listener), "listener", "existing-or-loopback-13300", listener),
      );
    }
  }
  const beforeNetworks = new Set(array(before?.networks));
  for (const network of array(after?.networks)) {
    if (
      !beforeNetworks.has(network) &&
      (typeof network !== "string" || !network.startsWith("opentrad_"))
    ) {
      differences.push(difference(String(network), "network", "existing-or-opentrad", network));
    }
  }

  const beforeLatency = Object.fromEntries(entries(before?.latencyP95));
  const afterLatency = Object.fromEntries(entries(after?.latencyP95));
  for (const [name, expected] of Object.entries(beforeLatency)) {
    const baselineMs = expected?.baselineMs;
    const windows = array(afterLatency[name]?.windowsMs);
    const recent = windows.slice(-5);
    if (
      typeof baselineMs === "number" &&
      Number.isFinite(baselineMs) &&
      baselineMs > 0 &&
      recent.length === 5 &&
      recent.every(
        (milliseconds) =>
          typeof milliseconds === "number" &&
          Number.isFinite(milliseconds) &&
          milliseconds > baselineMs * 1.2,
      )
    ) {
      differences.push(difference(name, "latencyP95", `<=${baselineMs * 1.2}`, recent));
    }
  }

  return differences.sort((left, right) =>
    `${left.name}:${left.field}`.localeCompare(`${right.name}:${right.field}`),
  );
}

function loadSnapshot(fileName) {
  const bytes = readFileSync(fileName);
  if (bytes.byteLength < 2 || bytes.byteLength > 4 * 1024 * 1024) {
    throw new Error("BASELINE_INVALID");
  }
  return JSON.parse(bytes.toString("utf8"));
}

function main(argv) {
  if (argv.length < 2 || argv.length > 3) throw new Error("BASELINE_ARGUMENTS_INVALID");
  const differences = compareExisting(loadSnapshot(argv[0]), loadSnapshot(argv[1]));
  const serialized = `${JSON.stringify(differences)}\n`;
  if (argv[2]) {
    const match = /(?:^|\/)(?:rollback-)?diff-([a-f0-9]{40})\.json$/u.exec(argv[2]);
    if (!match) throw new Error("BASELINE_DIFF_PATH_INVALID");
    const temporary = `${argv[2]}.tmp-${process.pid}`;
    writeFileSync(temporary, serialized, { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, argv[2]);
  }
  process.stdout.write(serialized);
  if (differences.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch {
    process.stderr.write("BASELINE_COMPARE_FAILED\n");
    process.exitCode = 1;
  }
}
