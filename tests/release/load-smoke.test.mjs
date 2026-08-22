import assert from "node:assert/strict";
import test from "node:test";

test("load evaluator enforces queue, quota, health, memory, and host stability", async () => {
  const { evaluateLoadSamples } = await import(
    new URL("../../scripts/release/load-smoke.mjs", import.meta.url)
  );
  const acceptedByUser = Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [`user-${index + 1}`, 10]),
  );
  const passing = evaluateLoadSamples({
    requests: 120,
    fiveXx: 1,
    healthChecks: 7,
    healthSuccesses: 7,
    maxRunning: 1,
    maxQueued: 1,
    maxPerUserActive: 1,
    acceptedByUser,
    workerMemoryBytes: 2_000_000_000,
    workerOomKills: 0,
    existingServiceRestartDelta: 0,
    latencyWindows: [1.01, 1.08, 1.12, 1.04, 1.19],
    residueJobs: 0,
  });
  assert.equal(passing.ok, true);

  const failed = evaluateLoadSamples({ ...passing.metrics, maxQueued: 2 });
  assert.equal(failed.ok, false);
  assert.ok(failed.failures.includes("QUEUE_LIMIT"));
});

test("load fixture models twelve users with deterministic threshold failures", async () => {
  const { runFixture } = await import(
    new URL("../../scripts/release/load-smoke.mjs", import.meta.url)
  );
  const passing = runFixture();
  assert.equal(passing.ok, true);
  assert.equal(Object.keys(passing.metrics.acceptedByUser).length, 12);
  assert.deepEqual(new Set(Object.values(passing.metrics.acceptedByUser)), new Set([10]));

  const failed = runFixture("queue-breach");
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.failures, ["QUEUE_LIMIT"]);
});

test("target mode is fixed to production and cannot shorten the acceptance phases", async () => {
  const { PRODUCTION_TIMINGS, parseTargetArguments } = await import(
    new URL("../../scripts/release/load-smoke.mjs", import.meta.url)
  );
  assert.deepEqual(PRODUCTION_TIMINGS, {
    drainMs: 60_000,
    holdMs: 300_000,
    rampMs: 60_000,
    retentionMs: 900_000,
    users: 12,
  });
  assert.deepEqual(
    parseTargetArguments(["--target", "https://opentrad.dynv6.net", "--profile-fd", "3"]),
    { profileFd: 3, target: "https://opentrad.dynv6.net" },
  );
  assert.throws(() =>
    parseTargetArguments(["--target", "https://example.invalid", "--profile-fd", "3"]),
  );
  assert.throws(() =>
    parseTargetArguments([
      "--target",
      "https://opentrad.dynv6.net",
      "--profile-fd",
      "3",
      "--hold-ms",
      "1",
    ]),
  );
});

test("target runner uses 12 ephemeral accounts and stops submissions on a live breach", async () => {
  const { runTarget } = await import(
    new URL("../../scripts/release/load-smoke.mjs", import.meta.url)
  );
  const events = [];
  const users = new Map();
  const transport = {
    async initialize(count) {
      events.push(`fixtures:${count}`);
    },
    async cleanupFixtures() {
      events.push("fixtures:cleanup");
    },
    async register(index) {
      const user = { cookie: `cookie-${index}`, index, password: `password-${index}` };
      users.set(index, user);
      events.push(`register:${index}`);
      return user;
    },
    async readiness() {
      return true;
    },
    async submit(user) {
      events.push(`submit:${user.index}`);
      return { accepted: true, id: `job-${user.index}`, queuePosition: 2 };
    },
    async status(_user, id) {
      return { id, status: "queued", queuePosition: 2 };
    },
    async cancel() {},
    async deleteAccount(user) {
      events.push(`delete:${user.index}`);
    },
  };
  const host = {
    async sample() {
      return {
        existingServiceRestartDelta: 0,
        latencyRatios: [1, 1, 1, 1, 1],
        residueJobs: 0,
        workerMemoryBytes: 1,
        workerOomKills: 0,
      };
    },
  };
  const result = await runTarget({
    host,
    profile: { existingServices: [] },
    sleep: async () => {},
    target: "https://opentrad.dynv6.net",
    timings: { drainMs: 1, holdMs: 1, pollMs: 1, rampMs: 1, retentionMs: 1, users: 12 },
    transport,
  });
  assert.equal(users.size, 12);
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("QUEUE_LIMIT"));
  assert.equal(events.filter((event) => event.startsWith("submit:")).length, 1);
  assert.equal(events.filter((event) => event.startsWith("delete:")).length, 12);
  assert.ok(events.includes("fixtures:12"));
  assert.ok(events.includes("fixtures:cleanup"));
});

test("target cleanup attempts every account and sanitizes deletion failures", async () => {
  const { runTarget } = await import(
    new URL("../../scripts/release/load-smoke.mjs", import.meta.url)
  );
  const deleted = [];
  const transport = {
    async register(index) {
      return { cookie: `private-cookie-${index}`, index, password: `private-password-${index}` };
    },
    async readiness() {
      return true;
    },
    async submit() {
      return { accepted: true, id: "opaque-job", queuePosition: 2 };
    },
    async status() {
      return { status: "queued", queuePosition: 2 };
    },
    async cancel() {},
    async deleteAccount(user) {
      deleted.push(user.index);
      if (user.index === 0) throw new Error(user.password);
    },
  };
  const host = {
    async sample() {
      return {
        existingServiceRestartDelta: 0,
        latencyRatios: [1, 1, 1, 1, 1],
        residueJobs: 0,
        workerMemoryBytes: 1,
        workerOomKills: 0,
      };
    },
  };
  const result = await runTarget({
    host,
    profile: { existingServices: [] },
    sleep: async () => {},
    target: "https://opentrad.dynv6.net",
    timings: { drainMs: 1, holdMs: 1, pollMs: 1, rampMs: 1, retentionMs: 1, users: 12 },
    transport,
  });
  assert.equal(deleted.length, 12);
  assert.ok(result.failures.includes("ACCOUNT_CLEANUP"));
  assert.doesNotMatch(JSON.stringify(result), /private-(?:password|cookie)/);
});

test("existing-service probe aborts at a bounded timeout without echoing its URL", async () => {
  const { boundedHead } = await import(
    new URL("../../scripts/release/load-smoke.mjs", import.meta.url)
  );
  await assert.rejects(
    boundedHead("https://private-service.example/health", {
      fetchImpl: async (_url, options) =>
        await new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new Error("private URL")));
        }),
      timeoutMs: 1,
    }),
    (error) =>
      error.code === "PAUSE_LOAD:EXISTING_SERVICE_TIMEOUT" &&
      !error.message.includes("private-service"),
  );
});
