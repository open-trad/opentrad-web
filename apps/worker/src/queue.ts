import { constants as fsConstants, lstatSync, realpathSync } from "node:fs";
import { link, lstat, open, readdir, rename, rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { isProxy } from "node:util/types";
import { isJobResultMediaType } from "@opentrad/contracts";
import { parseWorkerManifest, type WorkerManifest } from "./manifest.js";
import { copyExactUint8Array } from "./policies/bidArchive.js";

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const STATUS_BYTES_MAXIMUM = 4 * 1024;
const QueueError = Error;
const intrinsicArraySort = Array.prototype.sort;
const intrinsicArrayIncludes = Array.prototype.includes;
const intrinsicJsonParse = JSON.parse;
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
const intrinsicStringEndsWith = String.prototype.endsWith;
const intrinsicStringIncludes = String.prototype.includes;
const intrinsicBufferToString = Buffer.prototype.toString;
const intrinsicWeakSetAdd = WeakSet.prototype.add;
const intrinsicWeakSetHas = WeakSet.prototype.has;

export interface WorkerQueueOptions {
  readonly workerGid?: number;
}

export interface QueueClaim {
  readonly directory: string;
  readonly inputPath: string;
  readonly jobId: string;
  readonly manifestPath: string;
}

export interface ClaimedJobInput {
  readonly bytes: Uint8Array;
  readonly manifest: WorkerManifest;
}

export type WorkerFailureStatus =
  | Readonly<{
      schemaVersion: "worker-result-v1";
      status: "cancelled";
    }>
  | Readonly<{
      errorCode: "CONVERSION_FAILED";
      retryable: false;
      schemaVersion: "worker-result-v1";
      status: "failed";
    }>
  | Readonly<{
      mediaType: string;
      resultBytes: number;
      schemaVersion: "worker-result-v1";
      status: "succeeded";
    }>;

const claimBrand = new WeakSet<object>();

function fail(): never {
  throw new QueueError("WORKER_QUEUE_INVALID");
}

/** Internal worker boundary used by lifecycle modules; omitted from the package barrel. */
export function requireQueueClaim(input: unknown): QueueClaim {
  if (
    input === null ||
    typeof input !== "object" ||
    !intrinsicReflectApply(intrinsicWeakSetHas, claimBrand, [input])
  ) {
    fail();
  }
  return input as QueueClaim;
}

function errnoCode(input: unknown): string | undefined {
  if (input === null || typeof input !== "object") return undefined;
  try {
    const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, "code");
    return descriptor && "value" in descriptor && typeof descriptor.value === "string"
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function arrayIncludes(input: readonly unknown[], value: unknown): boolean {
  return intrinsicReflectApply(intrinsicArrayIncludes, input, [value]) as boolean;
}

function optionsSnapshot(input: unknown): number {
  try {
    if (input === undefined) return 10_100;
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
    if (keys.length !== 1 || keys[0] !== "workerGid") fail();
    const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, "workerGid");
    if (!descriptor || !("value" in descriptor)) fail();
    const value = descriptor.value;
    if (
      !intrinsicNumberIsSafeInteger(value) ||
      (value as number) < 0 ||
      (value as number) > 2_147_483_647
    ) {
      fail();
    }
    return value as number;
  } catch {
    return fail();
  }
}

function exactRoot(input: unknown): string {
  try {
    if (
      typeof input !== "string" ||
      input.length < 2 ||
      input.length > 4096 ||
      !isAbsolute(input) ||
      resolve(input) !== input ||
      input.includes("\0") ||
      realpathSync(input) !== input
    ) {
      fail();
    }
    const root = lstatSync(input);
    if (!root.isDirectory() || root.isSymbolicLink() || (root.mode & 0o777) !== 0o710) {
      fail();
    }
    return input;
  } catch {
    return fail();
  }
}

function sharedDirectorySync(path: string, workerGid: number): void {
  try {
    const info = lstatSync(path);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.gid !== workerGid ||
      (info.mode & 0o7777) !== 0o2770
    ) {
      fail();
    }
  } catch {
    fail();
  }
}

async function validateJobDirectory(path: string, workerGid: number): Promise<boolean> {
  let directory: Awaited<ReturnType<typeof lstat>>;
  try {
    directory = await lstat(path);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return false;
    return fail();
  }
  try {
    if (
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      directory.gid !== workerGid ||
      (directory.mode & 0o7777) !== 0o2770
    ) {
      fail();
    }
    const names = await readdir(path);
    if (names.length !== 2) fail();
    intrinsicReflectApply(intrinsicArraySort, names, []);
    if (names[0] !== "input.bin" || names[1] !== "manifest.json") fail();
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      if (!name) fail();
      const info = await lstat(join(path, name));
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.gid !== workerGid ||
        (info.mode & 0o777) !== 0o640
      ) {
        fail();
      }
    }
    return true;
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      try {
        await lstat(path);
      } catch (sourceError) {
        if (errnoCode(sourceError) === "ENOENT") return false;
      }
    }
    return fail();
  }
}

function createClaim(root: string, jobId: string): QueueClaim {
  const directory = join(root, "running", jobId);
  const output = intrinsicObjectCreate(null) as QueueClaim;
  for (const [key, value] of [
    ["directory", directory],
    ["inputPath", join(directory, "input.bin")],
    ["jobId", jobId],
    ["manifestPath", join(directory, "manifest.json")],
  ] as const) {
    intrinsicObjectDefineProperty(output, key, { enumerable: true, value });
  }
  intrinsicObjectFreeze(output);
  intrinsicReflectApply(intrinsicWeakSetAdd, claimBrand, [output]);
  return output;
}

function statusBytes(input: unknown): Uint8Array {
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
    const record = intrinsicObjectCreate(null) as Record<string, unknown>;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== "string") fail();
      const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, key);
      if (!descriptor || !("value" in descriptor)) fail();
      intrinsicObjectDefineProperty(record, key, {
        enumerable: true,
        value: descriptor.value,
      });
    }
    if (record.schemaVersion !== "worker-result-v1") fail();
    if (record.status === "cancelled") {
      if (
        keys.length !== 2 ||
        !arrayIncludes(keys, "schemaVersion") ||
        !arrayIncludes(keys, "status")
      )
        fail();
    } else if (record.status === "failed") {
      if (
        keys.length !== 4 ||
        !arrayIncludes(keys, "schemaVersion") ||
        !arrayIncludes(keys, "status") ||
        !arrayIncludes(keys, "errorCode") ||
        !arrayIncludes(keys, "retryable") ||
        record.errorCode !== "CONVERSION_FAILED" ||
        record.retryable !== false
      ) {
        fail();
      }
    } else if (record.status === "succeeded") {
      const mediaType = record.mediaType;
      const resultBytes = record.resultBytes;
      if (
        keys.length !== 4 ||
        !arrayIncludes(keys, "schemaVersion") ||
        !arrayIncludes(keys, "status") ||
        !arrayIncludes(keys, "mediaType") ||
        !arrayIncludes(keys, "resultBytes") ||
        !isJobResultMediaType(mediaType) ||
        !intrinsicNumberIsSafeInteger(resultBytes) ||
        (resultBytes as number) < 1 ||
        (resultBytes as number) > 25 * 1024 * 1024
      ) {
        fail();
      }
    } else {
      fail();
    }
    const encoded = Buffer.from(`${intrinsicJsonStringify(record)}\n`, "utf8");
    if (encoded.byteLength < 1 || encoded.byteLength > STATUS_BYTES_MAXIMUM) fail();
    return encoded;
  } catch {
    return fail();
  }
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  bytes: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
    if (written.bytesWritten < 1) fail();
    offset += written.bytesWritten;
  }
}

export class WorkerQueue {
  readonly #root: string;
  readonly #queued: string;
  readonly #running: string;
  readonly #outbox: string;
  readonly #control: string;
  readonly #workerGid: number;

  constructor(rootInput: unknown, optionInput?: unknown) {
    this.#workerGid = optionsSnapshot(optionInput);
    this.#root = exactRoot(rootInput);
    this.#queued = join(this.#root, "queued");
    this.#running = join(this.#root, "running");
    this.#outbox = join(this.#root, "outbox");
    this.#control = join(this.#root, "control");
    sharedDirectorySync(this.#queued, this.#workerGid);
    sharedDirectorySync(this.#running, this.#workerGid);
    sharedDirectorySync(this.#outbox, this.#workerGid);
    try {
      const control = lstatSync(this.#control);
      if (
        !control.isDirectory() ||
        control.isSymbolicLink() ||
        control.gid !== this.#workerGid ||
        (control.mode & 0o777) !== 0o750
      ) {
        fail();
      }
    } catch {
      fail();
    }
  }

  async claimNext(): Promise<QueueClaim | null> {
    let names: string[];
    try {
      names = await readdir(this.#queued);
      intrinsicReflectApply(intrinsicArraySort, names, []);
    } catch {
      return fail();
    }
    for (let index = 0; index < names.length; index += 1) {
      const jobId = names[index];
      if (!jobId || !intrinsicReflectApply(intrinsicRegExpTest, JOB_ID, [jobId])) fail();
      const source = join(this.#queued, jobId);
      const target = join(this.#running, jobId);
      if (!(await validateJobDirectory(source, this.#workerGid))) continue;
      try {
        const existing = await lstat(target).catch((error: unknown) => {
          if (errnoCode(error) === "ENOENT") return undefined;
          throw error;
        });
        if (existing !== undefined) fail();
        await rename(source, target);
      } catch (error) {
        if (errnoCode(error) === "ENOENT") continue;
        return fail();
      }
      if (!(await validateJobDirectory(target, this.#workerGid))) fail();
      return createClaim(this.#root, jobId);
    }
    return null;
  }

  async writeStatus(claim: QueueClaim, input: WorkerFailureStatus): Promise<void> {
    if (!intrinsicReflectApply(intrinsicWeakSetHas, claimBrand, [claim])) fail();
    const bytes = statusBytes(input);
    const temporary = join(claim.directory, "status.json.tmp");
    const status = join(claim.directory, "status.json");
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(
        temporary,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
        0o640,
      );
      const info = await handle.stat();
      if (!info.isFile() || info.gid !== this.#workerGid || (info.mode & 0o777) !== 0o640) fail();
      await writeAll(handle, bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await link(temporary, status);
      await rm(temporary, { force: true });
    } catch {
      try {
        await handle?.close();
      } catch {
        // The queue boundary reports one fixed failure.
      }
      await rm(temporary, { force: true }).catch(() => undefined);
      return fail();
    }
  }

  async readClaim(claim: QueueClaim): Promise<ClaimedJobInput> {
    if (!intrinsicReflectApply(intrinsicWeakSetHas, claimBrand, [claim])) fail();
    let manifestHandle: Awaited<ReturnType<typeof open>> | undefined;
    let inputHandle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      manifestHandle = await open(
        claim.manifestPath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
      );
      const manifestInfo = await manifestHandle.stat();
      if (
        !manifestInfo.isFile() ||
        manifestInfo.gid !== this.#workerGid ||
        (manifestInfo.mode & 0o777) !== 0o640 ||
        manifestInfo.size < 1 ||
        manifestInfo.size > 4 * 1024
      ) {
        fail();
      }
      const manifestBytes = Buffer.alloc(manifestInfo.size);
      const manifestRead = await manifestHandle.read(manifestBytes, 0, manifestBytes.length, 0);
      if (manifestRead.bytesRead !== manifestBytes.length) fail();
      await manifestHandle.close();
      manifestHandle = undefined;
      const text = intrinsicReflectApply(intrinsicBufferToString, manifestBytes, [
        "utf8",
      ]) as string;
      if (
        !(intrinsicReflectApply(intrinsicStringEndsWith, text, ["\n"]) as boolean) ||
        (intrinsicReflectApply(intrinsicStringIncludes, text, ["\0"]) as boolean)
      )
        fail();
      const manifest = parseWorkerManifest(intrinsicJsonParse(text));
      if (manifest.jobId !== claim.jobId) fail();
      inputHandle = await open(claim.inputPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      const inputInfo = await inputHandle.stat();
      if (
        !inputInfo.isFile() ||
        inputInfo.gid !== this.#workerGid ||
        (inputInfo.mode & 0o777) !== 0o640 ||
        inputInfo.size !== manifest.inputBytes ||
        inputInfo.size < 1 ||
        inputInfo.size > 52 * 1024 * 1024
      ) {
        fail();
      }
      const bytes = new Uint8Array(inputInfo.size);
      let offset = 0;
      while (offset < bytes.byteLength) {
        const result = await inputHandle.read(bytes, offset, bytes.byteLength - offset, offset);
        if (result.bytesRead < 1) fail();
        offset += result.bytesRead;
      }
      await inputHandle.close();
      inputHandle = undefined;
      return intrinsicObjectFreeze({ bytes, manifest });
    } catch {
      try {
        await manifestHandle?.close();
      } catch {
        // Preserve the fixed queue error.
      }
      try {
        await inputHandle?.close();
      } catch {
        // Preserve the fixed queue error.
      }
      return fail();
    }
  }

  async cancellationRequested(claim: QueueClaim): Promise<boolean> {
    if (!intrinsicReflectApply(intrinsicWeakSetHas, claimBrand, [claim])) fail();
    const marker = join(this.#control, `${claim.jobId}.cancel`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(marker, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      const info = await handle.stat();
      if (
        !info.isFile() ||
        info.gid !== this.#workerGid ||
        (info.mode & 0o777) !== 0o640 ||
        info.size !== 0
      ) {
        fail();
      }
      await handle.close();
      return true;
    } catch (error) {
      try {
        await handle?.close();
      } catch {
        // Preserve the fixed queue boundary.
      }
      if (errnoCode(error) === "ENOENT") return false;
      return fail();
    }
  }

  async publishFailure(claim: QueueClaim, input: WorkerFailureStatus): Promise<void> {
    if (!intrinsicReflectApply(intrinsicWeakSetHas, claimBrand, [claim])) fail();
    await this.writeStatus(claim, input);
    try {
      const names = await readdir(claim.directory);
      intrinsicReflectApply(intrinsicArraySort, names, []);
      if (
        names.length !== 3 ||
        names[0] !== "input.bin" ||
        names[1] !== "manifest.json" ||
        names[2] !== "status.json"
      ) {
        fail();
      }
      const status = await lstat(join(claim.directory, "status.json"));
      if (
        !status.isFile() ||
        status.isSymbolicLink() ||
        status.gid !== this.#workerGid ||
        (status.mode & 0o777) !== 0o640 ||
        status.size < 1 ||
        status.size > STATUS_BYTES_MAXIMUM
      ) {
        fail();
      }
      const target = join(this.#outbox, claim.jobId);
      const existing = await lstat(target).catch((error: unknown) => {
        if (errnoCode(error) === "ENOENT") return undefined;
        throw error;
      });
      if (existing !== undefined) fail();
      await rename(claim.directory, target);
    } catch {
      return fail();
    }
  }

  async publishSuccess(claim: QueueClaim, bytesInput: unknown, mediaType: string): Promise<void> {
    if (!intrinsicReflectApply(intrinsicWeakSetHas, claimBrand, [claim])) fail();
    const bytes = copyExactUint8Array(bytesInput, 25 * 1024 * 1024);
    if (bytes.byteLength < 1) fail();
    const result = join(claim.directory, "result.bin");
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(
        result,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
        0o640,
      );
      const info = await handle.stat();
      if (!info.isFile() || info.gid !== this.#workerGid || (info.mode & 0o777) !== 0o640) fail();
      await writeAll(handle, bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.writeStatus(claim, {
        mediaType,
        resultBytes: bytes.byteLength,
        schemaVersion: "worker-result-v1",
        status: "succeeded",
      });
      const names = await readdir(claim.directory);
      intrinsicReflectApply(intrinsicArraySort, names, []);
      if (
        names.length !== 4 ||
        names[0] !== "input.bin" ||
        names[1] !== "manifest.json" ||
        names[2] !== "result.bin" ||
        names[3] !== "status.json"
      ) {
        fail();
      }
      await rename(claim.directory, join(this.#outbox, claim.jobId));
    } catch {
      try {
        await handle?.close();
      } catch {
        // Preserve the fixed result handoff error.
      }
      return fail();
    }
  }
}
