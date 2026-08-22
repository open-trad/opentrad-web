import { constants as fsConstants } from "node:fs";
import { lstat, open, readdir, rename, rm } from "node:fs/promises";
import { isProxy } from "node:util/types";
import { copyExactUint8Array } from "./bidArchive.js";
import { copyFinalizedBidResultBytes, type FinalizedBidResult } from "./bidFinalize.js";

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_RESULT_BYTES = 25 * 1024 * 1024;
const MAX_STATUS_BYTES = 4 * 1024;
const HandoffError = Error;
const encoder = new TextEncoder();
const intrinsicJsonStringify = JSON.stringify;
const intrinsicNumberIsSafeInteger = Number.isSafeInteger;
const intrinsicObjectCreate = Object.create;
const intrinsicObjectDefineProperty = Object.defineProperty;
const intrinsicObjectFreeze = Object.freeze;
const intrinsicObjectGetPrototypeOf = Object.getPrototypeOf;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicReflectApply = Reflect.apply;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const intrinsicRegExpTest = RegExp.prototype.test;
const intrinsicWeakSetAdd = WeakSet.prototype.add;
const intrinsicWeakSetHas = WeakSet.prototype.has;

interface BidHandoffRuntime {
  readonly publish: (jobId: string, bytes: Uint8Array, status: Uint8Array) => Promise<void>;
}

const runtimeBrand = new WeakSet<object>();

function fail(): never {
  throw new HandoffError("CONVERSION_FAILED");
}

function exactRuntime(input: unknown): BidHandoffRuntime {
  try {
    if (
      input === null ||
      typeof input !== "object" ||
      isProxy(input) ||
      (intrinsicObjectGetPrototypeOf(input) !== intrinsicObjectPrototype &&
        intrinsicObjectGetPrototypeOf(input) !== null)
    ) {
      fail();
    }
    const keys = intrinsicReflectOwnKeys(input);
    const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, "publish");
    if (
      keys.length !== 1 ||
      keys[0] !== "publish" ||
      !descriptor ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "function"
    ) {
      fail();
    }
    const output = intrinsicObjectCreate(null) as BidHandoffRuntime;
    intrinsicObjectDefineProperty(output, "publish", {
      enumerable: true,
      value: descriptor.value,
    });
    intrinsicObjectFreeze(output);
    intrinsicReflectApply(intrinsicWeakSetAdd, runtimeBrand, [output]);
    return output;
  } catch {
    return fail();
  }
}

/** Test-only runtime seam. Deliberately omitted from the package barrel. */
export function createBidHandoffRuntimeForTesting(input: unknown): BidHandoffRuntime {
  return exactRuntime(input);
}

function exactRoot(input: unknown): string {
  if (
    typeof input !== "string" ||
    input.length < 2 ||
    input[0] !== "/" ||
    input[input.length - 1] === "/" ||
    input.includes("\0")
  ) {
    fail();
  }
  return input;
}

async function directory(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) fail();
}

async function sharedDirectory(path: string, workerGid: number): Promise<void> {
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.gid !== workerGid ||
    (info.mode & 0o7777) !== 0o2770
  ) {
    fail();
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isDirectory()) fail();
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeExclusive(
  path: string,
  input: unknown,
  maximumBytes: number,
  workerGid: number,
): Promise<void> {
  const bytes = copyExactUint8Array(input, maximumBytes);
  const handle = await open(
    path,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
    0o640,
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.gid !== workerGid || (info.mode & 0o777) !== 0o640) fail();
    let offset = 0;
    while (offset < bytes.byteLength) {
      const written = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
      if (written.bytesWritten < 1) fail();
      offset += written.bytesWritten;
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function createFileRuntime(rootInput: unknown, workerGidInput: unknown): BidHandoffRuntime {
  const root = exactRoot(rootInput);
  if (
    !intrinsicNumberIsSafeInteger(workerGidInput) ||
    (workerGidInput as number) < 0 ||
    (workerGidInput as number) > 2_147_483_647
  ) {
    fail();
  }
  const workerGid = workerGidInput as number;
  return exactRuntime({
    publish: async (jobId: string, bytesInput: Uint8Array, statusInput: Uint8Array) => {
      if (!intrinsicReflectApply(intrinsicRegExpTest, JOB_ID, [jobId])) fail();
      const bytes = copyExactUint8Array(bytesInput, MAX_RESULT_BYTES);
      const status = copyExactUint8Array(statusInput, MAX_STATUS_BYTES);
      const runningParent = `${root}/running`;
      const outboxParent = `${root}/outbox`;
      const running = `${runningParent}/${jobId}`;
      const outbox = `${outboxParent}/${jobId}`;
      const resultTemporary = `${running}/result.bin.tmp`;
      const result = `${running}/result.bin`;
      const statusTemporary = `${running}/status.json.tmp`;
      const statusPath = `${running}/status.json`;
      let moved = false;
      try {
        await directory(root);
        await sharedDirectory(runningParent, workerGid);
        await sharedDirectory(outboxParent, workerGid);
        await sharedDirectory(running, workerGid);
        const outboxExisting = await lstat(outbox).catch(() => undefined);
        if (outboxExisting !== undefined) fail();
        const entries = await readdir(running, { withFileTypes: true });
        if (entries.length !== 2) fail();
        for (const entry of entries) {
          if (
            entry.isSymbolicLink() ||
            !entry.isFile() ||
            (entry.name !== "input.bin" && entry.name !== "manifest.json")
          ) {
            fail();
          }
          const info = await lstat(`${running}/${entry.name}`);
          if (
            !info.isFile() ||
            info.isSymbolicLink() ||
            info.gid !== workerGid ||
            (info.mode & 0o777) !== 0o640
          )
            fail();
        }
        await writeExclusive(resultTemporary, bytes, MAX_RESULT_BYTES, workerGid);
        await writeExclusive(statusTemporary, status, MAX_STATUS_BYTES, workerGid);
        await rename(resultTemporary, result);
        await rename(statusTemporary, statusPath);
        await syncDirectory(running);
        await rename(running, outbox);
        moved = true;
        await syncDirectory(runningParent);
        await syncDirectory(outboxParent);
      } catch {
        if (!moved) {
          await rm(resultTemporary, { force: true }).catch(() => undefined);
          await rm(statusTemporary, { force: true }).catch(() => undefined);
          await rm(result, { force: true }).catch(() => undefined);
          await rm(statusPath, { force: true }).catch(() => undefined);
        }
        fail();
      }
    },
  });
}

/** Test-only production file runtime seam. Deliberately omitted from the package barrel. */
export function createBidHandoffFileRuntimeForTesting(
  root: unknown,
  workerGid: unknown,
): BidHandoffRuntime {
  return createFileRuntime(root, workerGid);
}

export function createBidHandoffRuntime(...input: readonly unknown[]): BidHandoffRuntime {
  if (input.length !== 0) fail();
  return createFileRuntime("/jobs", 10_100);
}

function ownInteger(input: object, key: string, minimum: number, maximum: number): number {
  const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, key);
  if (!descriptor || !("value" in descriptor)) fail();
  const value = descriptor.value;
  if (!intrinsicNumberIsSafeInteger(value) || value < minimum || value > maximum) fail();
  return value;
}

export async function handoffFinalizedBidResult(
  result: FinalizedBidResult,
  jobId: string,
  runtime: BidHandoffRuntime,
): Promise<void> {
  try {
    if (
      !intrinsicReflectApply(intrinsicWeakSetHas, runtimeBrand, [runtime]) ||
      !intrinsicReflectApply(intrinsicRegExpTest, JOB_ID, [jobId])
    ) {
      fail();
    }
    const bytes = copyFinalizedBidResultBytes(result);
    const mediaDescriptor = intrinsicReflectGetOwnPropertyDescriptor(result, "mediaType");
    if (
      !mediaDescriptor ||
      !("value" in mediaDescriptor) ||
      (mediaDescriptor.value !== "application/pdf" &&
        mediaDescriptor.value !==
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    ) {
      fail();
    }
    const status = encoder.encode(
      `${intrinsicJsonStringify({
        schemaVersion: "worker-result-v1",
        status: "succeeded",
        mediaType: mediaDescriptor.value,
        resultBytes: ownInteger(result, "byteLength", 1, MAX_RESULT_BYTES),
        pageCount: ownInteger(result, "pageCount", 1, 80),
        bodyPages: ownInteger(result, "bodyPages", 1, 80),
      })}\n`,
    );
    await intrinsicReflectApply(runtime.publish, undefined, [jobId, bytes, status]);
  } catch {
    return fail();
  }
}
