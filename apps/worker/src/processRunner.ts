import { ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { isProxy } from "node:util/types";
import { hardenWorkerValue } from "./manifest.js";
import { TOOLCHAIN_POLICY, type WorkerToolName } from "./toolchain.js";

const intrinsicAbortAddEventListener = AbortSignal.prototype.addEventListener;
const intrinsicAbortRemoveEventListener = AbortSignal.prototype.removeEventListener;
const intrinsicAbortSignalAbortedGetter = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)?.get;
const intrinsicArrayIsArray = Array.isArray;
const intrinsicArraySlice = Array.prototype.slice;
const intrinsicArrayPrototype = Array.prototype;
const intrinsicBufferIsBuffer = Buffer.isBuffer;
const intrinsicChildProcessKill = ChildProcess.prototype.kill;
const intrinsicClearTimeout = clearTimeout;
const intrinsicEventAddListener = EventEmitter.prototype.addListener;
const intrinsicEventRemoveListener = EventEmitter.prototype.removeListener;
const intrinsicGetPrototypeOf = Object.getPrototypeOf;
const intrinsicHasOwn = Object.prototype.hasOwnProperty;
const intrinsicNumberIsSafeInteger = Number.isSafeInteger;
const intrinsicObjectCreate = Object.create;
const intrinsicObjectDefineProperty = Object.defineProperty;
const intrinsicObjectFreeze = Object.freeze;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicProcessKill = process.kill;
const intrinsicReflectApply = Reflect.apply;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const intrinsicSetTimeout = setTimeout;
const intrinsicSpawn = nodeSpawn;
const intrinsicStringIncludes = String.prototype.includes;
const intrinsicTypedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "byteLength",
)?.get;
const intrinsicUint8ArrayPrototype = Uint8Array.prototype;
const intrinsicWeakSetAdd = WeakSet.prototype.add;
const intrinsicWeakSetHas = WeakSet.prototype.has;
const WorkerError = Error;

export const MAX_CAPTURE_BYTES = 64 * 1024;
export const PROCESS_GROUP_GRACE_MS = 2_000;

export const FIXED_PROCESS_ENVIRONMENT = hardenWorkerValue({
  base: {
    HOME: "/work/home",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: "/usr/bin:/bin:/opt/ocr/bin",
    TMPDIR: "/work/tmp",
  },
  image: {
    HOME: "/work/home",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: "/usr/bin:/bin:/opt/ocr/bin",
    TMPDIR: "/work/tmp",
    VIPS_BLOCK_UNTRUSTED: "TRUE",
    VIPS_CONCURRENCY: "1",
  },
  libreoffice: {
    HOME: "/work/home",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: "/usr/bin:/bin:/opt/ocr/bin",
    SAL_DISABLE_OPENCL: "1",
    TMPDIR: "/work/tmp",
  },
  ocr: {
    HOME: "/work/home",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    OMP_THREAD_LIMIT: "1",
    PATH: "/usr/bin:/bin:/opt/ocr/bin",
    TMPDIR: "/work/tmp",
  },
});

export type ProcessEnvironmentProfile = keyof typeof FIXED_PROCESS_ENVIRONMENT;

export interface InternalProcessSpec {
  readonly executable: string;
  readonly argv: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly shell: false;
  readonly timeoutMs: number;
}

interface ProcessRuntime {
  readonly spawn: (
    executable: string,
    argv: readonly string[],
    options: Readonly<Record<string, unknown>>,
  ) => unknown;
  readonly kill: (pid: number, signal: NodeJS.Signals) => unknown;
  readonly killChild: (child: unknown, signal: NodeJS.Signals) => unknown;
  readonly setTimer: (callback: () => void, delay: number) => unknown;
  readonly clearTimer: (timer: unknown) => void;
}

const brandedProcessSpecs = new WeakSet<object>();
const FIXED_STDIO = intrinsicObjectFreeze(["ignore", "ignore", "pipe"] as const);

function fail(): never {
  throw new WorkerError("CONVERSION_FAILED");
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return intrinsicReflectApply(intrinsicHasOwn, value, [key]) as boolean;
}

function denseStringArray(input: readonly string[]): readonly string[] {
  if (!intrinsicArrayIsArray(input) || isProxy(input)) fail();
  if (intrinsicGetPrototypeOf(input) !== intrinsicArrayPrototype) fail();
  const keys = intrinsicReflectOwnKeys(input);
  const lengthDescriptor = intrinsicReflectGetOwnPropertyDescriptor(input, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor)) fail();
  const length = lengthDescriptor.value;
  if (
    typeof length !== "number" ||
    !intrinsicNumberIsSafeInteger(length) ||
    length < 0 ||
    length > 256 ||
    keys.length !== length + 1
  ) {
    fail();
  }
  const output: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") fail();
    if (
      descriptor.value.length > 4_096 ||
      (intrinsicReflectApply(intrinsicStringIncludes, descriptor.value, ["\0"]) as boolean)
    ) {
      fail();
    }
    intrinsicObjectDefineProperty(output, String(index), {
      enumerable: true,
      value: descriptor.value,
      writable: false,
    });
  }
  return intrinsicObjectFreeze(output);
}

function isWorkerToolName(value: unknown): value is WorkerToolName {
  return typeof value === "string" && hasOwn(TOOLCHAIN_POLICY.tools, value);
}

function isEnvironmentProfile(value: unknown): value is ProcessEnvironmentProfile {
  return typeof value === "string" && hasOwn(FIXED_PROCESS_ENVIRONMENT, value);
}

/** Internal policy constructor. Deliberately omitted from the package barrel. */
export function createInternalProcessSpec(
  tool: WorkerToolName,
  argv: readonly string[],
  timeoutMs: number,
  environmentProfile: ProcessEnvironmentProfile,
): InternalProcessSpec {
  try {
    if (!isWorkerToolName(tool) || !isEnvironmentProfile(environmentProfile)) fail();
    if (!intrinsicNumberIsSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) fail();
    const spec = intrinsicObjectCreate(null) as InternalProcessSpec;
    const toolPolicy = TOOLCHAIN_POLICY.tools[tool];
    intrinsicObjectDefineProperty(spec, "executable", {
      enumerable: true,
      value: toolPolicy.executable,
    });
    intrinsicObjectDefineProperty(spec, "argv", {
      enumerable: true,
      value: denseStringArray(argv),
    });
    intrinsicObjectDefineProperty(spec, "environment", {
      enumerable: true,
      value: FIXED_PROCESS_ENVIRONMENT[environmentProfile],
    });
    intrinsicObjectDefineProperty(spec, "shell", { enumerable: true, value: false });
    intrinsicObjectDefineProperty(spec, "timeoutMs", { enumerable: true, value: timeoutMs });
    intrinsicObjectFreeze(spec);
    intrinsicReflectApply(intrinsicWeakSetAdd, brandedProcessSpecs, [spec]);
    return spec;
  } catch {
    fail();
  }
}

function dataFunction(input: object, key: keyof ProcessRuntime): (...args: never[]) => unknown {
  const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, key);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") fail();
  return descriptor.value;
}

function parseRuntime(input: unknown): ProcessRuntime {
  try {
    if (input === null || typeof input !== "object" || isProxy(input)) fail();
    const prototype = intrinsicGetPrototypeOf(input);
    if (prototype !== intrinsicObjectPrototype && prototype !== null) fail();
    const keys = intrinsicReflectOwnKeys(input);
    if (
      keys.length !== 5 ||
      !hasOwn(input, "spawn") ||
      !hasOwn(input, "kill") ||
      !hasOwn(input, "killChild") ||
      !hasOwn(input, "setTimer") ||
      !hasOwn(input, "clearTimer")
    ) {
      fail();
    }
    return {
      spawn: dataFunction(input, "spawn") as ProcessRuntime["spawn"],
      kill: dataFunction(input, "kill") as ProcessRuntime["kill"],
      killChild: dataFunction(input, "killChild") as ProcessRuntime["killChild"],
      setTimer: dataFunction(input, "setTimer") as ProcessRuntime["setTimer"],
      clearTimer: dataFunction(input, "clearTimer") as ProcessRuntime["clearTimer"],
    };
  } catch {
    fail();
  }
}

function signalAborted(signal: AbortSignal): boolean {
  if (!intrinsicAbortSignalAbortedGetter) fail();
  try {
    return intrinsicReflectApply(intrinsicAbortSignalAbortedGetter, signal, []) as boolean;
  } catch {
    fail();
  }
}

function ownData(input: object, key: PropertyKey): unknown {
  const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, key);
  if (!descriptor || !("value" in descriptor)) fail();
  return descriptor.value;
}

function chunkByteLength(chunk: unknown): number {
  try {
    if (chunk === null || typeof chunk !== "object" || isProxy(chunk)) fail();
    const isBuffer = intrinsicReflectApply(intrinsicBufferIsBuffer, Buffer, [chunk]) as boolean;
    if (!isBuffer && intrinsicGetPrototypeOf(chunk) !== intrinsicUint8ArrayPrototype) fail();
    if (!intrinsicTypedArrayByteLengthGetter) fail();
    return intrinsicReflectApply(intrinsicTypedArrayByteLengthGetter, chunk, []) as number;
  } catch {
    fail();
  }
}

function validPid(value: unknown): value is number {
  return typeof value === "number" && intrinsicNumberIsSafeInteger(value) && value > 1;
}

type FixedProcessError = "JOB_CANCELLED" | "CONVERSION_TIMEOUT" | "CONVERSION_FAILED";

function createRunner(runtimeInput: unknown) {
  const runtime = parseRuntime(runtimeInput);

  return function run(specInput: unknown, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      let spec: InternalProcessSpec;
      try {
        if (
          specInput === null ||
          typeof specInput !== "object" ||
          !(intrinsicReflectApply(intrinsicWeakSetHas, brandedProcessSpecs, [specInput]) as boolean)
        ) {
          fail();
        }
        spec = specInput as InternalProcessSpec;
        if (signalAborted(signal)) {
          reject(new WorkerError("JOB_CANCELLED"));
          return;
        }
      } catch {
        reject(new WorkerError("CONVERSION_FAILED"));
        return;
      }

      let child: unknown;
      try {
        const argv = intrinsicReflectApply(intrinsicArraySlice, spec.argv, []) as string[];
        child = intrinsicReflectApply(runtime.spawn, undefined, [
          spec.executable,
          argv,
          {
            detached: true,
            env: spec.environment,
            shell: false,
            stdio: FIXED_STDIO,
          },
        ]);
      } catch {
        reject(new WorkerError("CONVERSION_FAILED"));
        return;
      }

      let pid: unknown;
      let stderr: unknown;
      try {
        if (child === null || typeof child !== "object" || isProxy(child)) fail();
        pid = ownData(child, "pid");
        if (!validPid(pid)) fail();
        stderr = ownData(child, "stderr");
        if (stderr === null || typeof stderr !== "object" || isProxy(stderr)) fail();
      } catch {
        if (validPid(pid)) {
          try {
            intrinsicReflectApply(runtime.kill, undefined, [-pid, "SIGKILL"]);
          } catch {}
        } else {
          try {
            intrinsicReflectApply(runtime.killChild, undefined, [child, "SIGKILL"]);
          } catch {}
        }
        reject(new WorkerError("CONVERSION_FAILED"));
        return;
      }

      let settled = false;
      let terminating: FixedProcessError | undefined;
      let timeoutTimer: unknown;
      let graceTimer: unknown;
      let stderrBytes = 0;

      const removeListeners = () => {
        try {
          intrinsicReflectApply(intrinsicEventRemoveListener, stderr, ["data", onStderr]);
        } catch {}
        const removeChildListener = (event: string, listener: (...args: never[]) => void) => {
          try {
            intrinsicReflectApply(intrinsicEventRemoveListener, child, [event, listener]);
          } catch {}
        };
        removeChildListener("error", onError);
        removeChildListener("exit", onExit);
        removeChildListener("close", onClose);
        try {
          intrinsicReflectApply(intrinsicAbortRemoveEventListener, signal, ["abort", onAbort]);
        } catch {}
      };

      const clearTimers = () => {
        const clearTimer = (timer: unknown) => {
          if (timer === undefined) return;
          try {
            intrinsicReflectApply(runtime.clearTimer, undefined, [timer]);
          } catch {}
        };
        clearTimer(timeoutTimer);
        clearTimer(graceTimer);
      };

      const settle = (error?: FixedProcessError) => {
        if (settled) return;
        settled = true;
        clearTimers();
        removeListeners();
        if (error) reject(new WorkerError(error));
        else resolve();
      };

      const groupKill = (signalName: NodeJS.Signals) => {
        if (!validPid(pid)) return;
        try {
          intrinsicReflectApply(runtime.kill, undefined, [-pid, signalName]);
        } catch {}
      };

      const directKill = (signalName: NodeJS.Signals) => {
        try {
          intrinsicReflectApply(runtime.killChild, undefined, [child, signalName]);
        } catch {}
      };

      const beginTermination = (error: FixedProcessError) => {
        if (settled || terminating) return;
        terminating = error;
        if (!validPid(pid)) {
          directKill("SIGKILL");
          settle(error);
          return;
        }
        groupKill("SIGTERM");
        try {
          graceTimer = intrinsicReflectApply(runtime.setTimer, undefined, [
            () => {
              groupKill("SIGKILL");
              settle(error);
            },
            PROCESS_GROUP_GRACE_MS,
          ]);
        } catch {
          groupKill("SIGKILL");
          settle(error);
        }
      };

      function onStderr(chunk: unknown): void {
        if (settled || terminating) return;
        try {
          stderrBytes += chunkByteLength(chunk);
          if (stderrBytes > MAX_CAPTURE_BYTES) beginTermination("CONVERSION_FAILED");
        } catch {
          beginTermination("CONVERSION_FAILED");
        }
      }

      function onError(): void {
        if (terminating) return;
        beginTermination("CONVERSION_FAILED");
      }

      function onExit(code: unknown): void {
        if (terminating) return;
        settle(code === 0 ? undefined : "CONVERSION_FAILED");
      }

      function onClose(code: unknown): void {
        onExit(code);
      }

      function onAbort(): void {
        beginTermination("JOB_CANCELLED");
      }

      try {
        intrinsicReflectApply(intrinsicEventAddListener, stderr, ["data", onStderr]);
        intrinsicReflectApply(intrinsicEventAddListener, child, ["error", onError]);
        intrinsicReflectApply(intrinsicEventAddListener, child, ["exit", onExit]);
        intrinsicReflectApply(intrinsicEventAddListener, child, ["close", onClose]);
        intrinsicReflectApply(intrinsicAbortAddEventListener, signal, [
          "abort",
          onAbort,
          { once: true },
        ]);
        timeoutTimer = intrinsicReflectApply(runtime.setTimer, undefined, [
          () => beginTermination("CONVERSION_TIMEOUT"),
          spec.timeoutMs,
        ]);
        if (signalAborted(signal)) onAbort();
      } catch {
        beginTermination("CONVERSION_FAILED");
      }
    });
  };
}

const defaultRuntime = {
  clearTimer: (timer: unknown) => intrinsicClearTimeout(timer as NodeJS.Timeout),
  kill: (pid: number, signal: NodeJS.Signals) =>
    intrinsicReflectApply(intrinsicProcessKill, process, [pid, signal]),
  killChild: (child: unknown, signal: NodeJS.Signals) =>
    intrinsicReflectApply(intrinsicChildProcessKill, child, [signal]),
  setTimer: (callback: () => void, delay: number) => intrinsicSetTimeout(callback, delay),
  spawn: (
    executable: string,
    argv: readonly string[],
    options: Readonly<Record<string, unknown>>,
  ) => intrinsicSpawn(executable, argv, options),
};

export const runCommand = createRunner(defaultRuntime);

/** Test seam for deterministic child-process races. Deliberately omitted from the package barrel. */
export function createProcessRunnerForTesting(runtime: unknown): ReturnType<typeof createRunner> {
  return createRunner(runtime);
}
