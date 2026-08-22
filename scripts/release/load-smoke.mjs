#!/usr/bin/env node
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TWO_GIB = 2 * 1024 * 1024 * 1024;
const PRODUCTION_TARGET = "https://opentrad.dynv6.net";
const WORKER_CONTAINER = "opentrad-worker-1";
const JOB_VOLUME = "opentrad_job_ram";

export const PRODUCTION_TIMINGS = Object.freeze({
  drainMs: 60_000,
  holdMs: 300_000,
  rampMs: 60_000,
  retentionMs: 900_000,
  users: 12,
});

function pause(code) {
  const error = new Error(code);
  error.code = code;
  error.exitCode = 78;
  throw error;
}

const numeric = (value) => typeof value === "number" && Number.isFinite(value);

export function evaluateLoadSamples(input) {
  const metrics = Object.freeze({
    requests: input.requests,
    fiveXx: input.fiveXx,
    healthChecks: input.healthChecks,
    healthSuccesses: input.healthSuccesses,
    maxRunning: input.maxRunning,
    maxQueued: input.maxQueued,
    maxPerUserActive: input.maxPerUserActive,
    acceptedByUser: Object.freeze({ ...(input.acceptedByUser ?? {}) }),
    workerMemoryBytes: input.workerMemoryBytes,
    workerOomKills: input.workerOomKills,
    existingServiceRestartDelta: input.existingServiceRestartDelta,
    latencyWindows: Object.freeze([...(input.latencyWindows ?? [])]),
    residueJobs: input.residueJobs,
  });
  const failures = [];
  const numbers = [
    "requests",
    "fiveXx",
    "healthChecks",
    "healthSuccesses",
    "maxRunning",
    "maxQueued",
    "maxPerUserActive",
    "workerMemoryBytes",
    "workerOomKills",
    "existingServiceRestartDelta",
    "residueJobs",
  ];
  if (numbers.some((key) => !numeric(metrics[key])) || metrics.requests <= 0) {
    failures.push("METRICS_INVALID");
  } else {
    if (metrics.fiveXx / metrics.requests >= 0.01) failures.push("FIVE_XX_RATE");
    if (metrics.healthChecks <= 0 || metrics.healthSuccesses !== metrics.healthChecks) {
      failures.push("READINESS");
    }
    if (metrics.maxRunning > 1 || metrics.maxQueued > 1) failures.push("QUEUE_LIMIT");
    if (metrics.maxPerUserActive > 1) failures.push("PER_USER_ACTIVE_LIMIT");
    if (
      Object.keys(metrics.acceptedByUser).length !== 12 ||
      Object.values(metrics.acceptedByUser).some(
        (count) => !Number.isInteger(count) || count !== 10,
      )
    )
      failures.push("DAILY_QUOTA");
    if (metrics.workerMemoryBytes >= TWO_GIB || metrics.workerOomKills !== 0) {
      failures.push("WORKER_MEMORY");
    }
    if (metrics.existingServiceRestartDelta !== 0) failures.push("HOST_STABILITY");
    if (
      metrics.latencyWindows.length < 5 ||
      metrics.latencyWindows.slice(-5).some((ratio) => !numeric(ratio) || ratio > 1.2)
    )
      failures.push("EXISTING_SERVICE_LATENCY");
    if (metrics.residueJobs !== 0) failures.push("RETENTION_RESIDUE");
  }
  return Object.freeze({ failures: Object.freeze(failures), metrics, ok: failures.length === 0 });
}

export function runFixture(mode = "pass") {
  return evaluateLoadSamples({
    requests: 120,
    fiveXx: 1,
    healthChecks: 420,
    healthSuccesses: 420,
    maxRunning: 1,
    maxQueued: mode === "queue-breach" ? 2 : 1,
    maxPerUserActive: 1,
    acceptedByUser: Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [`user-${index + 1}`, 10]),
    ),
    workerMemoryBytes: 1_500_000_000,
    workerOomKills: 0,
    existingServiceRestartDelta: 0,
    latencyWindows: [1.03, 1.08, 1.1, 1.14, 1.18],
    residueJobs: 0,
  });
}

export function parseTargetArguments(args) {
  if (args.length !== 4) pause("PAUSE_LOAD:ARGUMENT_INVALID");
  const output = {};
  for (let index = 0; index < args.length; index += 2) {
    if (args[index] === "--target") output.target = args[index + 1];
    else if (args[index] === "--profile-fd") output.profileFd = Number(args[index + 1]);
    else pause("PAUSE_LOAD:ARGUMENT_INVALID");
  }
  if (output.target !== PRODUCTION_TARGET) pause("PAUSE_LOAD:TARGET_INVALID");
  if (!Number.isInteger(output.profileFd) || output.profileFd < 3) {
    pause("PAUSE_LOAD:PROFILE_FD_INVALID");
  }
  return Object.freeze(output);
}

function validateProfile(input) {
  if (input === null || typeof input !== "object" || !Array.isArray(input.existingServices)) {
    pause("PAUSE_LOAD:PROFILE_INVALID");
  }
  const ids = new Set();
  const existingServices = input.existingServices.map((service) => {
    let url;
    try {
      url = new URL(service?.url);
    } catch {
      pause("PAUSE_LOAD:PROFILE_INVALID");
    }
    if (
      typeof service?.id !== "string" ||
      !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(service.id) ||
      ids.has(service.id) ||
      typeof service.containerName !== "string" ||
      service.containerName.startsWith("opentrad-") ||
      !numeric(service.baselineP95Ms) ||
      service.baselineP95Ms <= 0 ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      pause("PAUSE_LOAD:PROFILE_INVALID");
    ids.add(service.id);
    return Object.freeze({
      baselineP95Ms: service.baselineP95Ms,
      containerName: service.containerName,
      id: service.id,
      url: url.href,
    });
  });
  if (existingServices.length !== 3) pause("PAUSE_LOAD:PROFILE_INVALID");
  return Object.freeze({ existingServices: Object.freeze(existingServices) });
}

function cookieHeader(response) {
  const values = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie")];
  const cookie = values
    .filter(Boolean)
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  if (!cookie) pause("PAUSE_LOAD:SESSION_COOKIE_MISSING");
  return cookie;
}

async function boundedJson(response) {
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 64 * 1024) pause("PAUSE_LOAD:RESPONSE_TOO_LARGE");
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    return {};
  }
}

const stateHeaders = (target, user) => ({
  ...(user ? { cookie: user.cookie } : {}),
  origin: target,
  "sec-fetch-site": "same-origin",
});

export function createProductionTransport(target) {
  const counters = { fiveXx: 0, requests: 0 };
  let fixtureRoot;
  const request = async (path, options = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`${target}${path}`, {
        ...options,
        redirect: "error",
        signal: controller.signal,
      });
      counters.requests += 1;
      if (response.status >= 500) counters.fiveXx += 1;
      return response;
    } finally {
      clearTimeout(timeout);
    }
  };
  return Object.freeze({
    snapshot: () => ({ ...counters }),
    async initialize(count) {
      fixtureRoot = await mkdtemp("/run/opentrad/load-fixtures-");
      for (let index = 0; index < count; index += 1) {
        const prefix = `# OpenTrad bounded load fixture ${index}\n`;
        const bytes = Buffer.from(prefix + "x".repeat(1024 - Buffer.byteLength(prefix)));
        await writeFile(join(fixtureRoot, `${index}.md`), bytes, { mode: 0o600 });
      }
    },
    async cleanupFixtures() {
      if (fixtureRoot) await rm(fixtureRoot, { force: true, recursive: true });
      fixtureRoot = undefined;
    },
    async register(index, sleep) {
      const username = `load_${index}_${randomBytes(6).toString("hex")}`;
      const password = `L9!${randomBytes(24).toString("base64url")}`;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const response = await request("/api/v1/register", {
          body: JSON.stringify({
            acknowledgements: { noPasswordRecovery: true },
            password,
            username,
          }),
          headers: { ...stateHeaders(target), "content-type": "application/json" },
          method: "POST",
        });
        if (response.status === 201) {
          await boundedJson(response);
          return Object.freeze({ cookie: cookieHeader(response), index, password, username });
        }
        if (response.status !== 429) pause("PAUSE_LOAD:REGISTER_FAILED");
        const retry = Math.min(65, Math.max(1, Number(response.headers.get("retry-after")) || 61));
        await sleep(retry * 1000);
      }
      pause("PAUSE_LOAD:REGISTER_RATE_LIMIT");
    },
    async readiness() {
      return (await request("/api/health/ready")).status === 200;
    },
    async submit(user) {
      if (!fixtureRoot) pause("PAUSE_LOAD:FIXTURE_ROOT_MISSING");
      const bytes = await readFile(join(fixtureRoot, `${user.index}.md`));
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: "text/markdown" }), "load-fixture.md");
      const response = await request("/api/v1/jobs", {
        body: form,
        headers: {
          ...stateHeaders(target, user),
          "idempotency-key": randomUUID().replaceAll("-", ""),
          "x-opentrad-job-request": JSON.stringify({
            inputBytes: bytes.length,
            inputFormat: "md",
            operation: "structured.convert",
            options: {},
            outputFormat: "docx",
          }),
          "x-opentrad-processing-consent": "server-v1",
        },
        method: "POST",
      });
      const body = await boundedJson(response);
      if ([200, 202].includes(response.status)) {
        if (typeof body.job?.id !== "string") pause("PAUSE_LOAD:JOB_RESPONSE_INVALID");
        return { accepted: true, id: body.job.id, queuePosition: body.job.queuePosition ?? 0 };
      }
      return { accepted: false, code: body.error?.code, status: response.status };
    },
    async status(user, id) {
      const response = await request(`/api/v1/jobs/${id}`, { headers: stateHeaders(target, user) });
      if (response.status !== 200) pause("PAUSE_LOAD:JOB_STATUS_FAILED");
      return (await boundedJson(response)).job;
    },
    async download(user, id) {
      const response = await request(`/api/v1/jobs/${id}/result`, {
        headers: stateHeaders(target, user),
      });
      if (response.status !== 200) pause("PAUSE_LOAD:RESULT_DOWNLOAD_FAILED");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) pause("PAUSE_LOAD:RESULT_MAGIC_INVALID");
    },
    async cancel(user, id) {
      await request(`/api/v1/jobs/${id}`, {
        headers: stateHeaders(target, user),
        method: "DELETE",
      });
    },
    async deleteAccount(user) {
      const response = await request("/api/auth/delete-user", {
        body: JSON.stringify({ password: user.password }),
        headers: { ...stateHeaders(target, user), "content-type": "application/json" },
        method: "POST",
      });
      if (![200, 204].includes(response.status)) pause("PAUSE_LOAD:ACCOUNT_DELETE_FAILED");
    },
  });
}

function parseBytes(value) {
  const match = String(value).match(/^([0-9.]+)([KMGT]?i?B)$/i);
  const factors = { B: 1, KB: 1e3, KIB: 1024, MB: 1e6, MIB: 1024 ** 2, GB: 1e9, GIB: 1024 ** 3 };
  if (!match || !factors[match[2].toUpperCase()]) pause("PAUSE_LOAD:DOCKER_METRIC_INVALID");
  return Number(match[1]) * factors[match[2].toUpperCase()];
}

async function countFiles(root) {
  let count = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) pause("PAUSE_LOAD:JOB_VOLUME_SYMLINK");
    if (entry.isDirectory()) count += await countFiles(join(root, entry.name));
    else if (entry.isFile()) count += 1;
  }
  return count;
}

const percentile95 = (values) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];

export async function boundedHead(url, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "HEAD",
      redirect: "manual",
      signal: controller.signal,
    });
    if (response.status >= 500) pause("PAUSE_LOAD:EXISTING_SERVICE_UNHEALTHY");
    return response;
  } catch (error) {
    if (error?.code?.startsWith?.("PAUSE_")) throw error;
    pause("PAUSE_LOAD:EXISTING_SERVICE_TIMEOUT");
  } finally {
    clearTimeout(timeout);
  }
}

export async function createProductionHost(profile) {
  const initial = new Map();
  for (const service of profile.existingServices) {
    const { stdout } = await execFileAsync("docker", [
      "inspect",
      service.containerName,
      "--format",
      "{{.RestartCount}}",
    ]);
    initial.set(service.id, Number(stdout.trim()));
  }
  const { stdout: volume } = await execFileAsync("docker", [
    "volume",
    "inspect",
    JOB_VOLUME,
    "--format",
    "{{.Mountpoint}}",
  ]);
  const jobRoot = volume.trim();
  if (!jobRoot || !(await stat(jobRoot)).isDirectory()) pause("PAUSE_LOAD:JOB_VOLUME_MISSING");
  const windows = [];
  let lastWindow = 0;
  return Object.freeze({
    async sample(now = Date.now()) {
      const { stdout: workerText } = await execFileAsync("docker", ["inspect", WORKER_CONTAINER]);
      const worker = JSON.parse(workerText)[0];
      const { stdout: memory } = await execFileAsync("docker", [
        "stats",
        "--no-stream",
        "--format",
        "{{.MemUsage}}",
        WORKER_CONTAINER,
      ]);
      let restartDelta = 0;
      for (const service of profile.existingServices) {
        const { stdout } = await execFileAsync("docker", [
          "inspect",
          service.containerName,
          "--format",
          "{{.RestartCount}}",
        ]);
        restartDelta += Math.max(0, Number(stdout.trim()) - initial.get(service.id));
      }
      if (lastWindow === 0 || now - lastWindow >= 60_000) {
        let worst = 0;
        for (const service of profile.existingServices) {
          const samples = [];
          for (let index = 0; index < 10; index += 1) {
            const started = performance.now();
            await boundedHead(service.url);
            samples.push(performance.now() - started);
          }
          worst = Math.max(worst, percentile95(samples) / service.baselineP95Ms);
        }
        windows.push(worst);
        lastWindow = now;
      }
      return {
        existingServiceRestartDelta: restartDelta,
        latencyRatios: [...windows],
        residueJobs: await countFiles(jobRoot),
        workerMemoryBytes: parseBytes(memory.trim().split("/")[0].trim()),
        workerOomKills: worker?.State?.OOMKilled === true ? 1 : 0,
      };
    },
  });
}

const isTerminal = (status) => ["succeeded", "failed", "cancelled"].includes(status);

export async function runTarget({
  host,
  profile,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  target,
  timings = { ...PRODUCTION_TIMINGS, pollMs: 1000 },
  transport,
}) {
  const users = [];
  const jobs = new Map();
  const acceptedByUser = Object.fromEntries(
    Array.from({ length: timings.users }, (_, index) => [`user-${index + 1}`, 0]),
  );
  const metrics = {
    requests: 1,
    fiveXx: 0,
    healthChecks: 0,
    healthSuccesses: 0,
    maxRunning: 0,
    maxQueued: 0,
    maxPerUserActive: 0,
    acceptedByUser,
    workerMemoryBytes: 0,
    workerOomKills: 0,
    existingServiceRestartDelta: 0,
    latencyWindows: [],
    residueJobs: 0,
  };
  const liveFailures = new Set();
  let stopped = false;
  const sample = async () => {
    metrics.healthChecks += 1;
    if (await transport.readiness()) metrics.healthSuccesses += 1;
    else liveFailures.add("READINESS");
    const value = await host.sample();
    metrics.workerMemoryBytes = Math.max(metrics.workerMemoryBytes, value.workerMemoryBytes);
    metrics.workerOomKills = Math.max(metrics.workerOomKills, value.workerOomKills);
    metrics.existingServiceRestartDelta = Math.max(
      metrics.existingServiceRestartDelta,
      value.existingServiceRestartDelta,
    );
    metrics.latencyWindows = value.latencyRatios;
    metrics.residueJobs = value.residueJobs;
    if (metrics.workerMemoryBytes >= TWO_GIB || metrics.workerOomKills > 0)
      liveFailures.add("WORKER_MEMORY");
    if (metrics.existingServiceRestartDelta > 0) liveFailures.add("HOST_STABILITY");
    if (
      metrics.latencyWindows.slice(-5).length === 5 &&
      metrics.latencyWindows.slice(-5).some((ratio) => ratio > 1.2)
    )
      liveFailures.add("EXISTING_SERVICE_LATENCY");
    if (liveFailures.size) stopped = true;
  };
  const poll = async () => {
    let running = 0;
    let queued = 0;
    const perUser = new Map();
    for (const [id, record] of jobs) {
      if (isTerminal(record.status)) continue;
      const value = await transport.status(record.user, id);
      record.status = value.status;
      if (value.status === "succeeded") await transport.download(record.user, id);
      if (["running", "cancelling"].includes(value.status)) running += 1;
      if (value.status === "queued") queued += 1;
      if (!isTerminal(value.status))
        perUser.set(record.user.index, (perUser.get(record.user.index) ?? 0) + 1);
    }
    metrics.maxRunning = Math.max(metrics.maxRunning, running);
    metrics.maxQueued = Math.max(metrics.maxQueued, queued);
    metrics.maxPerUserActive = Math.max(metrics.maxPerUserActive, ...perUser.values(), 0);
    if (running > 1 || queued > 1) liveFailures.add("QUEUE_LIMIT");
    if (metrics.maxPerUserActive > 1) liveFailures.add("PER_USER_ACTIVE_LIMIT");
    if (liveFailures.size) stopped = true;
  };
  const submit = async () => {
    if (stopped) return;
    const user = users.find(
      (candidate) =>
        acceptedByUser[`user-${candidate.index + 1}`] < 10 &&
        ![...jobs.values()].some((job) => job.user === candidate && !isTerminal(job.status)),
    );
    if (!user) return;
    const response = await transport.submit(user);
    if (response.accepted) {
      if (response.queuePosition > 1) {
        liveFailures.add("QUEUE_LIMIT");
        stopped = true;
        return;
      }
      jobs.set(response.id, { status: "queued", user });
      acceptedByUser[`user-${user.index + 1}`] += 1;
    } else if (!["QUEUE_FULL", "JOB_ALREADY_ACTIVE"].includes(response.code)) {
      liveFailures.add(
        response.code === "DAILY_QUOTA_EXCEEDED" ? "DAILY_QUOTA" : "SUBMISSION_FAILED",
      );
      stopped = true;
    }
  };
  try {
    await transport.initialize?.(timings.users);
    for (let index = 0; index < timings.users; index += 1)
      users.push(await transport.register(index, sleep));
    const rampStep = Math.max(1, Math.floor(timings.rampMs / timings.users));
    for (let index = 0; index < timings.users && !stopped; index += 1) {
      await submit();
      await sample();
      await poll();
      if (index + 1 < timings.users) await sleep(rampStep);
    }
    for (
      let index = 0, count = Math.max(1, Math.ceil(timings.holdMs / timings.pollMs));
      index < count && !stopped;
      index += 1
    ) {
      await poll();
      await submit();
      await sample();
      await sleep(timings.pollMs);
    }
    for (
      let index = 0, count = Math.max(1, Math.ceil(timings.drainMs / timings.pollMs));
      index < count;
      index += 1
    ) {
      await poll();
      await sample();
      if ([...jobs.values()].every((job) => isTerminal(job.status))) break;
      await sleep(timings.pollMs);
    }
    for (const [id, job] of jobs) if (!isTerminal(job.status)) await transport.cancel(job.user, id);
    for (
      let index = 0, count = Math.max(1, Math.ceil(timings.retentionMs / timings.pollMs));
      index < count;
      index += 1
    ) {
      await poll();
      await sample();
      if ([...jobs.values()].every((job) => isTerminal(job.status)) && metrics.residueJobs === 0)
        break;
      await sleep(timings.pollMs);
    }
  } finally {
    const cleanup = await Promise.allSettled(users.map((user) => transport.deleteAccount(user)));
    if (cleanup.some((result) => result.status === "rejected")) {
      liveFailures.add("ACCOUNT_CLEANUP");
    }
    try {
      await transport.cleanupFixtures?.();
    } catch {
      liveFailures.add("FIXTURE_CLEANUP");
    }
  }
  const observed = transport.snapshot?.();
  if (observed) {
    metrics.requests = observed.requests;
    metrics.fiveXx = observed.fiveXx;
  }
  const evaluated = evaluateLoadSamples(metrics);
  const failures = [...new Set([...liveFailures, ...evaluated.failures])].sort();
  return Object.freeze({
    failures: Object.freeze(failures),
    metrics: evaluated.metrics,
    ok: failures.length === 0,
    profile: { existingServiceCount: profile.existingServices.length },
    target,
  });
}

async function main() {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--fixture-mode") {
      const result = runFixture();
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    const options = parseTargetArguments(args);
    const profile = validateProfile(
      JSON.parse(await readFile(`/dev/fd/${options.profileFd}`, "utf8")),
    );
    const result = await runTarget({
      host: await createProductionHost(profile),
      profile,
      target: options.target,
      transport: createProductionTransport(options.target),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    const code = error?.code?.startsWith?.("PAUSE_") ? error.code : "PAUSE_LOAD:FAILED";
    process.stderr.write(`${code}\n`);
    process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 78;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
