import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { isProxy } from "node:util/types";
import { jobResultMediaType } from "@opentrad/contracts";
import { convertSpreadsheetToCsv } from "./adapters/spreadsheet.js";
import { type ClaimLease, recoverStaleRunningClaims, startClaimLease } from "./cleanup.js";
import { assembleBidJob, createBidAssemblyRuntime } from "./policies/bidAssembly.js";
import { copyFinalizedBidResultBytes } from "./policies/bidFinalize.js";
import { resolveServerConversionPlan } from "./policies/workspace.js";
import { runCommand } from "./processRunner.js";
import type { ClaimedJobInput, QueueClaim, WorkerQueue } from "./queue.js";
import { WorkerQueue as DefaultWorkerQueue } from "./queue.js";
import { verifyToolchain } from "./toolchain.js";

const POLL_INTERVAL_MS = 250;
const MainError = Error;
const intrinsicAbortAdd = AbortSignal.prototype.addEventListener;
const intrinsicClearInterval = clearInterval;
const intrinsicClearTimeout = clearTimeout;
const intrinsicReflectApply = Reflect.apply;
const intrinsicSetInterval = setInterval;
const intrinsicSetTimeout = setTimeout;
const intrinsicObjectCreate = Object.create;
const intrinsicObjectFreeze = Object.freeze;
const intrinsicObjectGetPrototypeOf = Object.getPrototypeOf;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const MAX_RESULT_BYTES = 25 * 1024 * 1024;

interface ConversionResult {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
}

export type WorkerClaimOutcome = "cancelled" | "failed" | "recovery" | "succeeded";

export interface WorkerClaimRuntime {
  readonly clearInterval: (timer: ReturnType<typeof setInterval>) => void;
  readonly convert: (claim: QueueClaim, signal: AbortSignal) => Promise<unknown>;
  readonly now: () => number;
  readonly publish: (claim: QueueClaim, result: unknown, signal: AbortSignal) => Promise<void>;
  readonly setInterval: (
    callback: () => void,
    milliseconds: number,
  ) => ReturnType<typeof setInterval>;
  readonly settleTimeoutMs: number;
  readonly startLease?: (claim: QueueClaim, onFailure: () => void) => Promise<ClaimLease>;
}

async function writeExact(path: string, bytes: Uint8Array): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      path,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    );
    let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
      if (result.bytesWritten < 1) throw new MainError("CONVERSION_FAILED");
      offset += result.bytesWritten;
    }
    await handle.sync();
    await handle.close();
  } catch {
    try {
      await handle?.close();
    } catch {
      // Preserve the fixed worker error.
    }
    throw new MainError("CONVERSION_FAILED");
  }
}

function validateMagic(bytes: Uint8Array, format: string): void {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_RESULT_BYTES) {
    throw new MainError("CONVERSION_FAILED");
  }
  if (
    format === "pdf" &&
    !(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)
  ) {
    throw new MainError("CONVERSION_FAILED");
  }
  if ((format === "docx" || format === "odt") && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    throw new MainError("CONVERSION_FAILED");
  }
  if (
    format === "png" &&
    !(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
  ) {
    throw new MainError("CONVERSION_FAILED");
  }
  if (
    format === "jpg" &&
    !(
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[bytes.byteLength - 2] === 0xff &&
      bytes[bytes.byteLength - 1] === 0xd9
    )
  ) {
    throw new MainError("CONVERSION_FAILED");
  }
  if (
    format === "webp" &&
    !(
      bytes.byteLength >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    )
  ) {
    throw new MainError("CONVERSION_FAILED");
  }
  if (
    format === "avif" &&
    !(
      bytes.byteLength >= 12 &&
      bytes[4] === 0x66 &&
      bytes[5] === 0x74 &&
      bytes[6] === 0x79 &&
      bytes[7] === 0x70 &&
      bytes[8] === 0x61 &&
      bytes[9] === 0x76 &&
      bytes[10] === 0x69 &&
      bytes[11] === 0x66
    )
  ) {
    throw new MainError("CONVERSION_FAILED");
  }
  if (
    format === "rtf" &&
    !(
      bytes.byteLength >= 5 &&
      bytes[0] === 0x7b &&
      bytes[1] === 0x5c &&
      bytes[2] === 0x72 &&
      bytes[3] === 0x74 &&
      bytes[4] === 0x66
    )
  ) {
    throw new MainError("CONVERSION_FAILED");
  }
  if (
    format === "html" &&
    !(
      bytes[0] === 0x3c ||
      (bytes.byteLength >= 4 &&
        bytes[0] === 0xef &&
        bytes[1] === 0xbb &&
        bytes[2] === 0xbf &&
        bytes[3] === 0x3c)
    )
  ) {
    throw new MainError("CONVERSION_FAILED");
  }
  if (format === "csv" && !(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) {
    throw new MainError("CONVERSION_FAILED");
  }
}

async function readResult(path: string, format: string): Promise<ConversionResult> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.size < 1 ||
      info.size > MAX_RESULT_BYTES ||
      (info.mode & 0o007) !== 0
    ) {
      throw new MainError("CONVERSION_FAILED");
    }
    const bytes = new Uint8Array(info.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (result.bytesRead < 1) throw new MainError("CONVERSION_FAILED");
      offset += result.bytesRead;
    }
    await handle.close();
    handle = undefined;
    validateMagic(bytes, format);
    return Object.freeze({ bytes, mediaType: jobResultMediaType(format) });
  } catch {
    try {
      await handle?.close();
    } catch {
      // Preserve the fixed worker error.
    }
    throw new MainError("CONVERSION_FAILED");
  }
}

async function executePlan(input: ClaimedJobInput, signal: AbortSignal): Promise<ConversionResult> {
  const plan = resolveServerConversionPlan(input.manifest);
  const root = plan.workspace.root;
  try {
    const workParent = await lstat(dirname(root));
    if (
      !workParent.isDirectory() ||
      workParent.isSymbolicLink() ||
      (workParent.mode & 0o777) !== 0o700
    ) {
      throw new MainError("CONVERSION_FAILED");
    }
    await mkdir(root, { mode: 0o700 });
    await writeExact(plan.workspace.stagedInput, input.bytes);
    for (let index = 0; index < plan.expectedArtifacts.length; index += 1) {
      const artifact = plan.expectedArtifacts[index];
      if (artifact) await mkdir(dirname(artifact.path), { mode: 0o700, recursive: true });
    }
    for (let index = 0; index < plan.commands.length; index += 1) {
      const command = plan.commands[index];
      if (!command || signal.aborted) throw new MainError("CONVERSION_FAILED");
      await runCommand(command, signal);
    }
    const results = plan.expectedArtifacts.filter((artifact) => artifact.role === "result");
    if (results.length !== 1 || !results[0]) throw new MainError("CONVERSION_FAILED");
    return await readResult(results[0].path, results[0].format);
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function defaultConvert(
  claim: QueueClaim,
  signal: AbortSignal,
  queue: WorkerQueue,
): Promise<ConversionResult> {
  const input = await queue.readClaim(claim);
  if (input.manifest.operation === "spreadsheet.to.csv") {
    const bytes = await convertSpreadsheetToCsv(
      {
        input: input.bytes,
        inputFormat: input.manifest.inputFormat,
        options: input.manifest.options,
        outputFormat: input.manifest.outputFormat,
      },
      signal,
    );
    validateMagic(bytes, "csv");
    return Object.freeze({ bytes, mediaType: jobResultMediaType("csv") });
  }
  if (input.manifest.operation === "bid.assemble") {
    const result = await assembleBidJob(
      input.bytes,
      input.manifest,
      signal,
      createBidAssemblyRuntime(),
    );
    const bytes = copyFinalizedBidResultBytes(result);
    validateMagic(bytes, input.manifest.outputFormat);
    return Object.freeze({ bytes, mediaType: result.mediaType });
  }
  return executePlan(input, signal);
}

const defaultRuntime: WorkerClaimRuntime = Object.freeze({
  clearInterval: intrinsicClearInterval,
  convert: async () => {
    throw new MainError("WORKER_QUEUE_REQUIRED");
  },
  now: Date.now,
  publish: async () => {
    throw new MainError("WORKER_MAIN_NOT_CONFIGURED");
  },
  setInterval: intrinsicSetInterval,
  settleTimeoutMs: 2_750,
});

function claimRuntime(input: unknown): WorkerClaimRuntime {
  try {
    if (
      input === null ||
      typeof input !== "object" ||
      isProxy(input) ||
      (intrinsicObjectGetPrototypeOf(input) !== intrinsicObjectPrototype &&
        intrinsicObjectGetPrototypeOf(input) !== null)
    ) {
      throw new MainError("WORKER_RUNTIME_INVALID");
    }
    const keys = intrinsicReflectOwnKeys(input);
    if (keys.length < 6 || keys.length > 7) throw new MainError("WORKER_RUNTIME_INVALID");
    const expected = [
      "clearInterval",
      "convert",
      "now",
      "publish",
      "setInterval",
      "settleTimeoutMs",
      "startLease",
    ];
    const output = intrinsicObjectCreate(null) as Record<string, unknown>;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== "string") throw new MainError("WORKER_RUNTIME_INVALID");
      let known = false;
      for (let expectedIndex = 0; expectedIndex < expected.length; expectedIndex += 1) {
        if (key === expected[expectedIndex]) known = true;
      }
      if (!known) throw new MainError("WORKER_RUNTIME_INVALID");
      const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, key);
      if (!descriptor || !("value" in descriptor)) throw new MainError("WORKER_RUNTIME_INVALID");
      output[key] = descriptor.value;
    }
    for (const key of ["clearInterval", "convert", "now", "publish", "setInterval"]) {
      if (typeof output[key] !== "function") throw new MainError("WORKER_RUNTIME_INVALID");
    }
    if (output.startLease !== undefined && typeof output.startLease !== "function") {
      throw new MainError("WORKER_RUNTIME_INVALID");
    }
    if (
      !Number.isSafeInteger(output.settleTimeoutMs) ||
      (output.settleTimeoutMs as number) < 1 ||
      (output.settleTimeoutMs as number) > 10_000
    ) {
      throw new MainError("WORKER_RUNTIME_INVALID");
    }
    return intrinsicObjectFreeze(output) as unknown as WorkerClaimRuntime;
  } catch {
    throw new MainError("WORKER_RUNTIME_INVALID");
  }
}

async function settleWithin(pending: Promise<unknown>, milliseconds: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending.then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolve) => {
        timer = intrinsicSetTimeout(() => resolve(false), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) intrinsicClearTimeout(timer);
  }
}

async function publishCancelled(claim: QueueClaim, queue: WorkerQueue): Promise<"cancelled"> {
  await queue.publishFailure(claim, {
    schemaVersion: "worker-result-v1",
    status: "cancelled",
  });
  return "cancelled";
}

async function publishFailed(claim: QueueClaim, queue: WorkerQueue): Promise<"failed"> {
  await queue.publishFailure(claim, {
    errorCode: "CONVERSION_FAILED",
    retryable: false,
    schemaVersion: "worker-result-v1",
    status: "failed",
  });
  return "failed";
}

export async function runClaim(
  claim: QueueClaim,
  queue: WorkerQueue,
  runtimeInput: WorkerClaimRuntime = defaultRuntime,
): Promise<WorkerClaimOutcome> {
  let runtime: WorkerClaimRuntime;
  try {
    runtime = claimRuntime(runtimeInput);
  } catch {
    try {
      return await publishFailed(claim, queue);
    } catch {
      return "recovery";
    }
  }
  const controller = new AbortController();
  let poll: ReturnType<typeof setInterval> | undefined;
  let controlFailed = false;
  let checking: Promise<void> | undefined;
  let conversion: Promise<unknown> | undefined;
  let lease: ClaimLease | undefined;
  let keepRecoveryLease = false;
  const check = async (): Promise<void> => {
    if (checking) return checking;
    checking = (async () => {
      try {
        if (await queue.cancellationRequested(claim)) controller.abort();
      } catch {
        controlFailed = true;
        controller.abort();
      } finally {
        checking = undefined;
      }
    })();
    return checking;
  };
  const releaseLease = async () => {
    const current = lease;
    lease = undefined;
    if (current) await current.stop();
  };
  const cancelled = async () => {
    await releaseLease();
    return publishCancelled(claim, queue);
  };
  const failed = async () => {
    await releaseLease();
    return publishFailed(claim, queue);
  };
  try {
    await check();
    if (controlFailed) return await failed();
    if (controller.signal.aborted) return await cancelled();
    if (runtime.startLease) {
      try {
        lease = await runtime.startLease(claim, () => {
          controlFailed = true;
          controller.abort();
        });
      } catch {
        return await failed();
      }
    }
    try {
      poll = intrinsicReflectApply(runtime.setInterval, undefined, [
        () => {
          void check().catch(() => undefined);
        },
        POLL_INTERVAL_MS,
      ]);
    } catch {
      return await failed();
    }
    const abortPromise = new Promise<never>((_resolve, reject) => {
      intrinsicReflectApply(intrinsicAbortAdd, controller.signal, [
        "abort",
        () => reject(new MainError("WORKER_CANCELLED")),
        { once: true },
      ]);
    });
    void abortPromise.catch(() => undefined);
    try {
      conversion = Promise.resolve(
        intrinsicReflectApply(runtime.convert, undefined, [claim, controller.signal]),
      );
    } catch {
      return await failed();
    }
    void conversion.catch(() => undefined);
    try {
      const result = await Promise.race([conversion, abortPromise]);
      await check();
      if (controlFailed) return await failed();
      if (controller.signal.aborted) {
        const settled = await settleWithin(conversion, runtime.settleTimeoutMs);
        if (!settled) {
          keepRecoveryLease = true;
          lease?.stopHeartbeat();
          return "recovery";
        }
        return await cancelled();
      }
      await releaseLease();
      await intrinsicReflectApply(runtime.publish, undefined, [claim, result, controller.signal]);
      return "succeeded";
    } catch {
      if (controller.signal.aborted) {
        const settled = await settleWithin(conversion, runtime.settleTimeoutMs);
        if (!settled) {
          keepRecoveryLease = true;
          lease?.stopHeartbeat();
          return "recovery";
        }
        return await cancelled();
      }
      return await failed();
    }
  } catch {
    return "recovery";
  } finally {
    if (poll !== undefined) {
      try {
        intrinsicReflectApply(runtime.clearInterval, undefined, [poll]);
      } catch {
        // A completed claim is not re-executed because timer cleanup failed.
      }
    }
    if (checking) await checking.catch(() => undefined);
    if (!keepRecoveryLease) await releaseLease().catch(() => undefined);
  }
}

/** Test-only real conversion dispatcher seam. Deliberately omitted from the package barrel. */
export function createWorkerClaimRuntimeForTesting(queue: WorkerQueue): WorkerClaimRuntime {
  return Object.freeze({
    ...defaultRuntime,
    convert: (claim: QueueClaim, signal: AbortSignal) => defaultConvert(claim, signal, queue),
    publish: async (claim: QueueClaim, result: unknown) => {
      if (result === null || typeof result !== "object") throw new MainError("CONVERSION_FAILED");
      const value = result as ConversionResult;
      await queue.publishSuccess(claim, value.bytes, value.mediaType);
    },
  });
}

export async function runWorker(root: string): Promise<never> {
  await verifyToolchain();
  await recoverStaleRunningClaims(root, Date.now());
  const queue = new DefaultWorkerQueue(root);
  const baseRuntime = createWorkerClaimRuntimeForTesting(queue);
  const runtime: WorkerClaimRuntime = Object.freeze({
    ...baseRuntime,
    startLease: (claim: QueueClaim, onFailure: () => void) =>
      startClaimLease(claim, {
        clearInterval,
        heartbeatMs: 30_000,
        now: Date.now,
        onFailure,
        setInterval,
        workerGid: 10_100,
      }),
  });
  for (;;) {
    const claim = await queue.claimNext();
    if (claim) {
      await runClaim(claim, queue, runtime);
      continue;
    }
    await new Promise((resolve) => intrinsicSetTimeout(resolve, 250));
  }
}

function configuredRoot(): string {
  const value = process.env.OPENTRAD_JOB_ROOT;
  if (typeof value !== "string" || value.length < 2) throw new MainError("WORKER_CONFIG_INVALID");
  return value;
}

const executed = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false;
if (executed) {
  void runWorker(configuredRoot()).catch(() => {
    process.exitCode = 1;
  });
}
