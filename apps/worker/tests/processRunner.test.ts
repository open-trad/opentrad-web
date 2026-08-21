import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import * as workerExports from "../src/index.js";
import {
  createInternalProcessSpec,
  createProcessRunnerForTesting,
  FIXED_PROCESS_ENVIRONMENT,
  MAX_CAPTURE_BYTES,
  PROCESS_GROUP_GRACE_MS,
} from "../src/processRunner.js";

class FakeChild extends EventEmitter {
  readonly stderr = new EventEmitter();

  constructor(readonly pid: number | undefined = 4312) {
    super();
  }
}

interface TimerEntry {
  active: boolean;
  callback: () => void;
  delay: number;
}

function harness(child = new FakeChild()) {
  const spawnCalls: unknown[][] = [];
  const killCalls: Array<[number, NodeJS.Signals]> = [];
  const killChildCalls: Array<[unknown, NodeJS.Signals]> = [];
  const timers: TimerEntry[] = [];
  const runtime = {
    spawn: (...args: unknown[]) => {
      spawnCalls.push(args);
      return child;
    },
    kill: (pid: number, signal: NodeJS.Signals) => {
      killCalls.push([pid, signal]);
      return true;
    },
    killChild: (target: unknown, signal: NodeJS.Signals) => {
      killChildCalls.push([target, signal]);
      return true;
    },
    setTimer: (callback: () => void, delay: number) => {
      const timer = { active: true, callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer: TimerEntry) => {
      timer.active = false;
    },
  };
  return {
    child,
    killChildCalls,
    killCalls,
    run: createProcessRunnerForTesting(runtime),
    spawnCalls,
    timers,
  };
}

function fixedSpec() {
  return createInternalProcessSpec("pandoc", ["--version"], 5_000, "base");
}

async function expectFixedFailure(promise: Promise<void>, code: string): Promise<void> {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}$`));
}

describe("isolated process runner", () => {
  it("spawns a branded allowlisted spec without shell, stdin, stdout, PATH discovery, or secrets", async () => {
    const test = harness();
    const promise = test.run(fixedSpec(), new AbortController().signal);

    expect(test.spawnCalls).toHaveLength(1);
    expect(test.spawnCalls[0]).toEqual([
      "/usr/bin/pandoc",
      ["--version"],
      {
        detached: true,
        env: FIXED_PROCESS_ENVIRONMENT.base,
        shell: false,
        stdio: ["ignore", "ignore", "pipe"],
      },
    ]);
    expect(JSON.stringify(test.spawnCalls[0])).not.toContain("SECRET");
    test.child.emit("close", 0, null);
    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects forged commands and keeps the internal brand factory out of the public barrel", async () => {
    const test = harness();
    const forged = {
      executable: "/bin/sh",
      argv: ["-c", "curl https://example.invalid"],
      environment: { API_SECRET: "do-not-leak" },
      shell: false,
      timeoutMs: 1,
    };

    await expectFixedFailure(test.run(forged, new AbortController().signal), "CONVERSION_FAILED");
    expect(test.spawnCalls).toHaveLength(0);
    expect(workerExports).not.toHaveProperty("createInternalProcessSpec");
    expect(() =>
      createInternalProcessSpec("curl" as never, ["https://example.invalid"], 1, "base"),
    ).toThrow("CONVERSION_FAILED");
  });

  it("snapshots dense own-data argv without invoking hostile getters or proxies", () => {
    let getterCalls = 0;
    const accessor = ["--version"];
    Object.defineProperty(accessor, 0, {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "--version";
      },
    });
    const sparse = new Array<string>(1);

    expect(() => createInternalProcessSpec("pandoc", accessor, 1, "base")).toThrow(
      "CONVERSION_FAILED",
    );
    expect(() => createInternalProcessSpec("pandoc", sparse, 1, "base")).toThrow(
      "CONVERSION_FAILED",
    );
    expect(() =>
      createInternalProcessSpec("pandoc", new Proxy(["--version"], {}), 1, "base"),
    ).toThrow("CONVERSION_FAILED");
    expect(getterCalls).toBe(0);
  });

  it("does not consult mutable Array or String prototype methods at runtime", () => {
    const originalEvery = Array.prototype.every;
    const originalPush = Array.prototype.push;
    const originalIncludes = String.prototype.includes;
    let spec: ReturnType<typeof fixedSpec> | undefined;
    let runner: ReturnType<typeof createProcessRunnerForTesting> | undefined;
    try {
      Array.prototype.every = (() => {
        throw new Error("poisoned every");
      }) as unknown as typeof Array.prototype.every;
      Array.prototype.push = () => {
        throw new Error("poisoned push");
      };
      String.prototype.includes = () => {
        throw new Error("poisoned includes");
      };
      spec = fixedSpec();
      runner = createProcessRunnerForTesting({
        spawn: () => new FakeChild(),
        kill: () => true,
        killChild: () => true,
        setTimer: setTimeout,
        clearTimer: clearTimeout,
      });
    } finally {
      Array.prototype.every = originalEvery;
      Array.prototype.push = originalPush;
      String.prototype.includes = originalIncludes;
    }
    expect(spec?.argv).toEqual(["--version"]);
    expect(runner).toBeTypeOf("function");
  });

  it("rejects an already-aborted job before spawn", async () => {
    const test = harness();
    const controller = new AbortController();
    controller.abort();

    await expectFixedFailure(test.run(fixedSpec(), controller.signal), "JOB_CANCELLED");
    expect(test.spawnCalls).toHaveLength(0);
    expect(test.timers).toHaveLength(0);
  });

  it("terminates the whole process group on abort and escalates after the exact grace", async () => {
    const test = harness();
    const controller = new AbortController();
    const promise = test.run(fixedSpec(), controller.signal);
    controller.abort();

    expect(test.killCalls).toEqual([[-4312, "SIGTERM"]]);
    const grace = test.timers.find(({ delay }) => delay === PROCESS_GROUP_GRACE_MS);
    expect(grace).toBeDefined();
    expect(grace?.delay).toBe(2_000);
    grace?.callback();
    expect(test.killCalls).toEqual([
      [-4312, "SIGTERM"],
      [-4312, "SIGKILL"],
    ]);
    await expectFixedFailure(promise, "JOB_CANCELLED");
    expect(test.child.listenerCount("error")).toBe(0);
    expect(test.child.listenerCount("exit")).toBe(0);
    expect(test.child.listenerCount("close")).toBe(0);
    expect(test.child.stderr.listenerCount("data")).toBe(0);
  });

  it("does not let early child events bypass the exact abort grace or SIGKILL", async () => {
    const test = harness();
    const controller = new AbortController();
    let state = "pending";
    const promise = test.run(fixedSpec(), controller.signal);
    promise.then(
      () => {
        state = "resolved";
      },
      () => {
        state = "rejected";
      },
    );
    controller.abort();
    test.child.emit("exit", 0, null);
    test.child.emit("close", 0, null);
    test.child.emit("error", new Error("late child error"));
    await Promise.resolve();

    expect(state).toBe("pending");
    expect(test.killCalls).toEqual([[-4312, "SIGTERM"]]);
    const grace = test.timers.find(({ delay }) => delay === PROCESS_GROUP_GRACE_MS);
    expect(grace?.active).toBe(true);
    grace?.callback();
    await expectFixedFailure(promise, "JOB_CANCELLED");
    expect(test.killCalls).toEqual([
      [-4312, "SIGTERM"],
      [-4312, "SIGKILL"],
    ]);
  });

  it("times out with a fixed error and a TERM-to-KILL process-group sequence", async () => {
    const test = harness();
    const promise = test.run(fixedSpec(), new AbortController().signal);
    const timeout = test.timers.find(({ delay }) => delay === 5_000);
    timeout?.callback();
    expect(test.killCalls).toEqual([[-4312, "SIGTERM"]]);
    test.timers.find(({ delay }) => delay === PROCESS_GROUP_GRACE_MS)?.callback();

    await expectFixedFailure(promise, "CONVERSION_TIMEOUT");
    expect(test.killCalls.at(-1)).toEqual([-4312, "SIGKILL"]);
  });

  it("rejects and directly kills an invalid pid immediately after spawn", async () => {
    const test = harness(new FakeChild(0));
    const promise = test.run(fixedSpec(), new AbortController().signal);

    await expectFixedFailure(promise, "CONVERSION_FAILED");
    expect(test.killCalls).toEqual([]);
    expect(test.killChildCalls).toEqual([[test.child, "SIGKILL"]]);
    expect(test.timers).toEqual([]);
  });

  it("sanitizes synchronous spawn throws and child error/exit/close races", async () => {
    const secret = "/work/customer-name-input.docx";
    const throwingRuntime = {
      spawn: () => {
        throw new Error(secret);
      },
      kill: () => true,
      killChild: () => true,
      setTimer: setTimeout,
      clearTimer: clearTimeout,
    };
    await expectFixedFailure(
      createProcessRunnerForTesting(throwingRuntime)(fixedSpec(), new AbortController().signal),
      "CONVERSION_FAILED",
    );

    const test = harness();
    const promise = test.run(fixedSpec(), new AbortController().signal);
    test.child.emit("error", new Error(secret));
    test.child.emit("exit", 0, null);
    test.child.emit("close", 0, null);
    test.timers.find(({ delay }) => delay === PROCESS_GROUP_GRACE_MS)?.callback();
    await expectFixedFailure(promise, "CONVERSION_FAILED");
  });

  it("fails closed when listener registration throws and when group kills throw", async () => {
    const child = new FakeChild();
    Object.freeze((child as unknown as { _events: object })._events);
    const listenerTest = harness(child);
    const listenerPromise = listenerTest.run(fixedSpec(), new AbortController().signal);
    listenerTest.timers.find(({ delay }) => delay === PROCESS_GROUP_GRACE_MS)?.callback();
    await expectFixedFailure(listenerPromise, "CONVERSION_FAILED");

    const killTest = harness();
    const throwing = createProcessRunnerForTesting({
      spawn: () => killTest.child,
      kill: (pid: number, signal: NodeJS.Signals) => {
        killTest.killCalls.push([pid, signal]);
        throw new Error("secret kill failure");
      },
      killChild: () => true,
      setTimer: (callback: () => void, delay: number) => {
        const timer = { active: true, callback, delay };
        killTest.timers.push(timer);
        return timer;
      },
      clearTimer: (timer: TimerEntry) => {
        timer.active = false;
      },
    });
    const controller = new AbortController();
    const promise = throwing(fixedSpec(), controller.signal);
    controller.abort();
    killTest.timers.find(({ delay }) => delay === PROCESS_GROUP_GRACE_MS)?.callback();
    await expectFixedFailure(promise, "JOB_CANCELLED");
    expect(killTest.killCalls).toEqual([
      [-4312, "SIGTERM"],
      [-4312, "SIGKILL"],
    ]);
  });

  it("counts only genuine Buffer and Uint8Array chunks and bounds stderr at 64 KiB", async () => {
    const test = harness();
    const promise = test.run(fixedSpec(), new AbortController().signal);
    test.child.stderr.emit("data", Buffer.alloc(MAX_CAPTURE_BYTES));
    test.child.stderr.emit("data", new Uint8Array([1]));
    test.timers.find(({ delay }) => delay === PROCESS_GROUP_GRACE_MS)?.callback();
    await expectFixedFailure(promise, "CONVERSION_FAILED");

    const fakeChunk = harness();
    const fakePromise = fakeChunk.run(fixedSpec(), new AbortController().signal);
    fakeChunk.child.stderr.emit("data", { byteLength: MAX_CAPTURE_BYTES + 1 });
    fakeChunk.timers.find(({ delay }) => delay === PROCESS_GROUP_GRACE_MS)?.callback();
    await expectFixedFailure(fakePromise, "CONVERSION_FAILED");
  });

  it("terminates a still-live child on error instead of clearing the escalation grace", async () => {
    const test = harness();
    const promise = test.run(fixedSpec(), new AbortController().signal);
    test.child.emit("error", new Error("/work/private-name.docx"));
    expect(test.killCalls).toEqual([[-4312, "SIGTERM"]]);
    test.timers.find(({ delay }) => delay === PROCESS_GROUP_GRACE_MS)?.callback();
    await expectFixedFailure(promise, "CONVERSION_FAILED");
    expect(test.killCalls.at(-1)).toEqual([-4312, "SIGKILL"]);
  });

  it("cleans up every hostile child-introspection failure with a fixed finite error", async () => {
    const cases: Array<{
      child: unknown;
      getterCalls?: () => number;
      groupPid?: number;
      label: string;
    }> = [];
    cases.push({ child: null, label: "null child" });
    cases.push({ child: new Proxy(new FakeChild(), {}), label: "proxy child" });
    const missingPid = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
    missingPid.stderr = new EventEmitter();
    cases.push({ child: missingPid, label: "missing pid" });
    cases.push({ child: new FakeChild(-7), label: "negative pid" });
    let pidGetterCalls = 0;
    const pidAccessor = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
    pidAccessor.stderr = new EventEmitter();
    Object.defineProperty(pidAccessor, "pid", {
      get() {
        pidGetterCalls += 1;
        return 123;
      },
    });
    cases.push({ child: pidAccessor, getterCalls: () => pidGetterCalls, label: "pid accessor" });
    const nullStderr = new EventEmitter();
    Object.defineProperty(nullStderr, "pid", { value: 4991 });
    Object.defineProperty(nullStderr, "stderr", { value: null });
    cases.push({ child: nullStderr, groupPid: 4991, label: "null stderr" });
    let stderrGetterCalls = 0;
    const stderrAccessor = new EventEmitter();
    Object.defineProperty(stderrAccessor, "pid", { value: 4992 });
    Object.defineProperty(stderrAccessor, "stderr", {
      get() {
        stderrGetterCalls += 1;
        return new EventEmitter();
      },
    });
    cases.push({
      child: stderrAccessor,
      getterCalls: () => stderrGetterCalls,
      groupPid: 4992,
      label: "stderr accessor",
    });

    for (const entry of cases) {
      const groupKills: Array<[number, NodeJS.Signals]> = [];
      const directKills: Array<[unknown, NodeJS.Signals]> = [];
      const run = createProcessRunnerForTesting({
        spawn: () => entry.child,
        kill: (pid: number, signal: NodeJS.Signals) => {
          groupKills.push([pid, signal]);
          throw new Error("kill details");
        },
        killChild: (target: unknown, signal: NodeJS.Signals) => {
          directKills.push([target, signal]);
          throw new Error("direct kill details");
        },
        setTimer: setTimeout,
        clearTimer: clearTimeout,
      });
      await expectFixedFailure(run(fixedSpec(), new AbortController().signal), "CONVERSION_FAILED");
      if (entry.groupPid) {
        expect(groupKills, entry.label).toEqual([[-entry.groupPid, "SIGKILL"]]);
        expect(directKills, entry.label).toEqual([]);
      } else {
        expect(groupKills, entry.label).toEqual([]);
        expect(directKills, entry.label).toEqual([[entry.child, "SIGKILL"]]);
      }
      expect(entry.getterCalls?.() ?? 0, entry.label).toBe(0);
    }
  });

  it("ignores late and duplicate events after one successful settlement", async () => {
    const test = harness();
    const controller = new AbortController();
    test.child.on("error", () => undefined);
    const promise = test.run(fixedSpec(), controller.signal);
    test.child.emit("exit", 0, null);
    test.child.emit("close", 9, null);
    test.child.emit("error", new Error("late secret"));
    controller.abort();

    await expect(promise).resolves.toBeUndefined();
    expect(test.killCalls).toEqual([]);
    expect(test.timers.every(({ active }) => !active)).toBe(true);
  });
});
