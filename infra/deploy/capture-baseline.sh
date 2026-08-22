#!/bin/sh
set -eu

phase=${1:-}
release_sha=${2:-}
case "$phase" in
  before | after | rollback-before | rollback-after)
    printf '%s' "$release_sha" | grep -Eq '^[a-f0-9]{40}$' || {
      printf '%s\n' "PAUSE_BASELINE:INVALID_SHA" >&2
      exit 78
    }
    baseline_name="$phase-$release_sha.json"
    ;;
  manual-preflight | acceptance)
    test -z "$release_sha" || {
      printf '%s\n' "PAUSE_BASELINE:UNEXPECTED_ARGUMENT" >&2
      exit 78
    }
    baseline_name="$phase.json"
    ;;
  *)
    printf '%s\n' "PAUSE_BASELINE:PHASE_INVALID" >&2
    exit 78
    ;;
esac

if test "${OPENTRAD_TEST_MODE:-0}" = 1; then
  test -n "${OPENTRAD_ROOT:-}" || {
    printf '%s\n' "PAUSE_BASELINE:TEST_ROOT_MISSING" >&2
    exit 78
  }
  baseline_root="$OPENTRAD_ROOT/baselines"
  install -d -m 0750 "$baseline_root"
elif test "$(id -u)" -eq 0; then
  baseline_root=/opt/opentrad/baselines
  install -d -o root -g opentrad-deploy -m 0750 "$baseline_root"
else
  printf '%s\n' "PAUSE_BASELINE:ROOT_REQUIRED" >&2
  exit 78
fi
capture_root="$(mktemp -d /run/opentrad-baseline.XXXXXX)"
chmod 0700 "$capture_root"
trap 'rm -rf "$capture_root"' EXIT HUP INT TERM

docker ps --no-trunc --format '{{json .}}' >"$capture_root/ps.jsonl"
container_ids="$(docker ps -q)"
if test -n "$container_ids"; then
  # Docker emits only hexadecimal IDs; the command intentionally expands one argument per ID.
  # shellcheck disable=SC2086
  docker inspect $container_ids >"$capture_root/inspect.json"
else
  printf '[]\n' >"$capture_root/inspect.json"
fi
docker network ls --format '{{json .}}' >"$capture_root/networks.jsonl"
docker compose ls --format json >"$capture_root/compose.json"
ss -lntp >"$capture_root/listeners.txt"
docker stats --no-stream --format '{{json .}}' >"$capture_root/stats.jsonl"
df -Pk / /opt/opentrad >"$capture_root/disk.txt"
free -b >"$capture_root/memory.txt"
"$(dirname "$0")/capture-latency.mjs" >"$capture_root/latency.json"

CAPTURE_PHASE="$phase" CAPTURE_ROOT="$capture_root" CAPTURE_OUTPUT="$baseline_root/$baseline_name" node --input-type=module - <<'NODE'
import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const captureRoot = process.env.CAPTURE_ROOT;
const output = process.env.CAPTURE_OUTPUT;
const phase = process.env.CAPTURE_PHASE;
if (!captureRoot || !output || !phase) throw new Error("BASELINE_CAPTURE_INVALID");
const read = (name) => readFileSync(`${captureRoot}/${name}`, "utf8");
const jsonLines = (name) =>
  read(name)
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
const existingProjects = new Set(["openvac-production", "paperbanana-hk", "tensor-auto"]);
const includesOpenTrad = phase === "after" || phase === "rollback-after" || phase === "acceptance";
const inspected = JSON.parse(read("inspect.json"));
const containers = {};
for (const value of inspected) {
  const project = value?.Config?.Labels?.["com.docker.compose.project"];
  const name = String(value.Name ?? "").replace(/^\//u, "");
  const openTrad = project === "opentrad" && name.startsWith("opentrad-");
  if (!existingProjects.has(project) && !(includesOpenTrad && openTrad)) continue;
  if (!name || (!includesOpenTrad && openTrad)) continue;
  const publishedPorts = [];
  for (const [target, bindings] of Object.entries(value?.NetworkSettings?.Ports ?? {})) {
    if (!Array.isArray(bindings)) continue;
    for (const binding of bindings) {
      publishedPorts.push(`${binding.HostIp}:${binding.HostPort}->${target}`);
    }
  }
  const networks = Object.entries(value?.NetworkSettings?.Networks ?? {}).map(
    ([network, details]) => `${network}:${details?.NetworkID ?? ""}`,
  );
  containers[name] = {
    containerId: value.Id,
    health: value?.State?.Health?.Status ?? "none",
    imageDigest: value.Image,
    networks: networks.sort(),
    publishedPorts: publishedPorts.sort(),
    restartCount: value.RestartCount,
    state: value?.State?.Status,
  };
}
const listeners = read("listeners.txt")
  .split("\n")
  .slice(1)
  .map((line) => line.trim().split(/\s+/u)[3])
  .filter(Boolean)
  .sort();
const networks = jsonLines("networks.jsonl")
  .map((entry) => entry.Name)
  .filter(
    (name) =>
      typeof name === "string" && (includesOpenTrad || !name.startsWith("opentrad_")),
  )
  .sort();
const composeProjects = JSON.parse(read("compose.json"))
  .map((entry) => entry.Name)
  .filter((name) => existingProjects.has(name))
  .sort();
const stats = Object.fromEntries(
  jsonLines("stats.jsonl")
    .filter((entry) => Object.hasOwn(containers, entry.Name))
    .map((entry) => [entry.Name, { cpuPercent: entry.CPUPerc, memory: entry.MemUsage }]),
);
const sortedContainers = Object.fromEntries(
  Object.entries(containers)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => [name, { ...value, ...stats[name] }]),
);
const snapshot = {
  composeProjects,
  containers: sortedContainers,
  disk: read("disk.txt").trim().split("\n"),
  latencyP95: JSON.parse(read("latency.json")),
  listeners,
  memory: read("memory.txt").trim().split("\n"),
  networks,
  schemaVersion: 1,
};
const temporary = `${output}.tmp-${process.pid}`;
writeFileSync(temporary, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
chmodSync(temporary, 0o600);
renameSync(temporary, output);
NODE

if test "${OPENTRAD_TEST_MODE:-0}" != 1; then
  chown root:opentrad-deploy "$baseline_root/$baseline_name"
  chmod 0640 "$baseline_root/$baseline_name"
fi

printf '%s\n' "BASELINE_CAPTURED:$baseline_name"
