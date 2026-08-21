import { randomUUID } from "node:crypto";
import {
  chmodSync,
  chownSync,
  constants as fsConstants,
  lstatSync,
  mkdirSync,
  type ReadStream,
  realpathSync,
} from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  type CreateJobRequest,
  CreateJobRequestSchema,
  type JobErrorCode,
} from "@opentrad/contracts";

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_INPUT_BYTES = 52 * 1024 * 1024;
const STATES = ["queued", "running", "outbox", "done"] as const;
const intrinsicJsonStringify = JSON.stringify;
const intrinsicGetPrototypeOf = Object.getPrototypeOf;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicReflectOwnKeys = Reflect.ownKeys;

export class JobFileError extends Error {
  readonly code: JobErrorCode;

  constructor(code: JobErrorCode) {
    super(code);
    this.code = code;
  }
}

export interface JobFilesOptions {
  readonly workerGid?: number;
}

export interface StageAndQueueInput {
  readonly jobId: string;
  readonly declaredBytes: number;
  readonly request: unknown;
  readonly source: AsyncIterable<Uint8Array>;
  readonly signal?: AbortSignal;
  readonly validate?: (path: string, signal?: AbortSignal) => Promise<void>;
  readonly scan: (source: AsyncIterable<Uint8Array>, signal?: AbortSignal) => Promise<"clean">;
}

export interface QueuedJobFiles {
  readonly directory: string;
  readonly inputPath: string;
}

export interface PromoteResultInput {
  readonly jobId: string;
  readonly resultBytes: number;
  readonly source: AsyncIterable<Uint8Array>;
  readonly signal?: AbortSignal;
}

export interface PublishResultInput {
  readonly jobId: string;
  readonly resultBytes: number;
}

export interface OpenedJobResult {
  readonly close: () => Promise<void>;
  readonly size: number;
  readonly stream: ReadStream;
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  bytes: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(bytes, offset, bytes.byteLength - offset, null);
    if (result.bytesWritten <= 0) throw new JobFileError("INVALID_REQUEST");
    offset += result.bytesWritten;
  }
}

function optionsSnapshot(input: JobFilesOptions | undefined): number {
  if (input === undefined) return 10_100;
  if (input === null || typeof input !== "object") throw new Error("JOB_ROOT_UNSAFE");
  const prototype = intrinsicGetPrototypeOf(input);
  const keys = intrinsicReflectOwnKeys(input);
  if (
    (prototype !== intrinsicObjectPrototype && prototype !== null) ||
    keys.length > 1 ||
    (keys.length === 1 && keys[0] !== "workerGid")
  ) {
    throw new Error("JOB_ROOT_UNSAFE");
  }
  const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, "workerGid");
  const value = descriptor && "value" in descriptor ? descriptor.value : 10_100;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 2_147_483_647) {
    throw new Error("JOB_ROOT_UNSAFE");
  }
  return value as number;
}

function manifest(jobId: string, request: CreateJobRequest): Uint8Array {
  return Buffer.from(
    `${intrinsicJsonStringify({
      schemaVersion: "server-v1",
      jobId,
      operation: request.operation,
      inputFormat: request.inputFormat,
      outputFormat: request.outputFormat,
      options: request.options,
      inputBytes: request.inputBytes,
    })}\n`,
    "utf8",
  );
}

function abortGate(signal: AbortSignal | undefined): {
  readonly promise: Promise<never>;
  readonly remove: () => void;
} {
  let listener: (() => void) | undefined;
  const promise = new Promise<never>((_resolve, reject) => {
    if (signal?.aborted) {
      reject(new JobFileError("INVALID_REQUEST"));
      return;
    }
    listener = () => reject(new JobFileError("INVALID_REQUEST"));
    signal?.addEventListener("abort", listener, { once: true });
  });
  void promise.catch(() => undefined);
  return {
    promise,
    remove: () => {
      if (listener) signal?.removeEventListener("abort", listener);
    },
  };
}

export class JobFiles {
  readonly #root: string;
  readonly #staging: string;
  readonly #queued: string;
  readonly #outbox: string;
  readonly #done: string;
  readonly #workerGid: number;
  readonly #stagingByJob = new Map<string, string>();

  constructor(root: string, optionInput?: JobFilesOptions) {
    try {
      this.#workerGid = optionsSnapshot(optionInput);
      if (
        typeof root !== "string" ||
        root.length < 2 ||
        root.length > 4096 ||
        !isAbsolute(root) ||
        resolve(root) !== root ||
        root.includes("\0")
      ) {
        throw new Error();
      }
      const canonicalParent = realpathSync(dirname(root));
      const canonicalRoot = join(canonicalParent, basename(root));
      try {
        const existing = lstatSync(root);
        if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error();
        if (realpathSync(root) !== canonicalRoot) throw new Error();
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          mkdirSync(canonicalRoot, { mode: 0o700 });
        } else {
          throw error;
        }
      }
      const rootInfo = lstatSync(canonicalRoot);
      const effectiveUser =
        typeof process.geteuid === "function" ? process.geteuid() : rootInfo.uid;
      if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || rootInfo.uid !== effectiveUser) {
        throw new Error();
      }
      chmodSync(canonicalRoot, 0o700);
      this.#root = canonicalRoot;
      this.#staging = join(canonicalRoot, "staging");
      this.#queued = join(canonicalRoot, "queued");
      this.#outbox = join(canonicalRoot, "outbox");
      this.#done = join(canonicalRoot, "done");
      for (const path of [
        this.#staging,
        this.#queued,
        join(canonicalRoot, "running"),
        this.#outbox,
        this.#done,
      ]) {
        try {
          mkdirSync(path, { mode: 0o700 });
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
        }
        const info = lstatSync(path);
        if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== effectiveUser) {
          throw new Error();
        }
        chmodSync(path, 0o700);
      }
      this.#grantWorkerTraversal(canonicalRoot);
      this.#grantWorker(this.#queued, true);
      this.#grantWorker(join(canonicalRoot, "running"), true);
      this.#grantWorker(this.#outbox, true);
    } catch {
      throw new Error("JOB_ROOT_UNSAFE");
    }
  }

  async stageAndQueue(input: StageAndQueueInput): Promise<QueuedJobFiles> {
    let request: CreateJobRequest;
    try {
      request = CreateJobRequestSchema.parse(input?.request);
    } catch {
      throw new JobFileError("INVALID_REQUEST");
    }
    if (
      input === null ||
      typeof input !== "object" ||
      typeof input.jobId !== "string" ||
      !JOB_ID.test(input.jobId) ||
      !Number.isSafeInteger(input.declaredBytes) ||
      input.declaredBytes < 1 ||
      input.declaredBytes > MAX_INPUT_BYTES ||
      request.inputBytes !== input.declaredBytes ||
      typeof input.scan !== "function" ||
      input.source === null ||
      typeof input.source !== "object"
    ) {
      throw new JobFileError("INVALID_REQUEST");
    }
    const stagingDirectory = join(this.#staging, randomUUID());
    const queuedDirectory = join(this.#queued, input.jobId);
    let inputHandle: Awaited<ReturnType<typeof open>> | undefined;
    let writingSource: AsyncGenerator<Uint8Array> | undefined;
    const abort = abortGate(input.signal);
    try {
      mkdirSync(stagingDirectory, { mode: 0o700 });
      this.#stagingByJob.set(input.jobId, stagingDirectory);
      const inputPath = join(stagingDirectory, "input.bin");
      inputHandle = await open(inputPath, "wx", 0o600);
      let actualBytes = 0;
      const source = input.source;
      const declaredBytes = input.declaredBytes;
      const signal = input.signal;
      writingSource = (async function* () {
        for await (const chunk of source) {
          if (signal?.aborted || !(chunk instanceof Uint8Array)) {
            throw new JobFileError("INVALID_REQUEST");
          }
          actualBytes += chunk.byteLength;
          if (actualBytes > declaredBytes || actualBytes > MAX_INPUT_BYTES) {
            throw new JobFileError(
              actualBytes > MAX_INPUT_BYTES ? "FILE_TOO_LARGE" : "INVALID_REQUEST",
            );
          }
          await writeAll(inputHandle as Awaited<ReturnType<typeof open>>, chunk);
          if (signal?.aborted) throw new JobFileError("INVALID_REQUEST");
          yield chunk;
        }
      })();
      const scanning = Promise.resolve(input.scan(writingSource, input.signal));
      void scanning.catch(() => undefined);
      const scanResult = await Promise.race([scanning, abort.promise]);
      await writingSource.return(undefined);
      if (scanResult !== "clean" || input.signal?.aborted) {
        throw new JobFileError("SCANNER_UNAVAILABLE");
      }
      if (actualBytes !== declaredBytes) throw new JobFileError("INVALID_REQUEST");
      if (input.validate) {
        const validation = Promise.resolve(input.validate(inputPath, input.signal));
        void validation.catch(() => undefined);
        await Promise.race([validation, abort.promise]);
      }
      await inputHandle.sync();
      await inputHandle.close();
      inputHandle = undefined;

      const manifestPath = join(stagingDirectory, "manifest.json");
      const manifestHandle = await open(manifestPath, "wx", 0o600);
      try {
        await writeAll(manifestHandle, manifest(input.jobId, request));
        await manifestHandle.sync();
      } finally {
        await manifestHandle.close();
      }
      await syncDirectory(stagingDirectory);
      this.#grantWorker(manifestPath, false);
      this.#grantWorker(join(stagingDirectory, "input.bin"), false);
      this.#grantWorker(stagingDirectory, true);
      this.#grantWorker(this.#queued, true);
      await syncDirectory(stagingDirectory);
      await rename(stagingDirectory, queuedDirectory);
      await syncDirectory(this.#queued);
      this.#stagingByJob.delete(input.jobId);
      return Object.freeze({
        directory: queuedDirectory,
        inputPath: join(queuedDirectory, "input.bin"),
      });
    } catch (error) {
      try {
        await writingSource?.return(undefined);
      } catch {
        // Preserve only the fixed admission error.
      }
      try {
        await inputHandle?.close();
      } catch {
        // Preserve only the fixed admission error.
      }
      this.#stagingByJob.delete(input.jobId);
      await rm(stagingDirectory, { recursive: true, force: true });
      if (error instanceof JobFileError || (error instanceof Error && "code" in error)) throw error;
      throw new JobFileError("INVALID_REQUEST");
    } finally {
      abort.remove();
    }
  }

  async findStagingInput(jobId: string): Promise<string> {
    const directory = this.#stagingByJob.get(jobId);
    if (directory === undefined) throw new JobFileError("INVALID_REQUEST");
    return join(directory, "input.bin");
  }

  async exists(jobId: string): Promise<boolean> {
    if (!JOB_ID.test(jobId)) return false;
    if (this.#stagingByJob.has(jobId)) return true;
    for (const state of STATES) {
      try {
        const info = await lstat(join(this.#root, state, jobId));
        if (info.isDirectory() && !info.isSymbolicLink()) return true;
      } catch {
        // Continue across the finite private state roots.
      }
    }
    return false;
  }

  async destroy(jobId: string): Promise<void> {
    if (!JOB_ID.test(jobId)) throw new JobFileError("INVALID_REQUEST");
    const staging = this.#stagingByJob.get(jobId);
    this.#stagingByJob.delete(jobId);
    if (staging) await rm(staging, { recursive: true, force: true });
    await rm(join(this.#staging, jobId), { recursive: true, force: true });
    for (const state of STATES) {
      await rm(join(this.#root, state, jobId), { recursive: true, force: true });
    }
  }

  async cleanupOrphanStaging(maxAgeMs: number, now = Date.now()): Promise<number> {
    if (
      !Number.isSafeInteger(maxAgeMs) ||
      maxAgeMs < 1_000 ||
      maxAgeMs > 24 * 60 * 60_000 ||
      !Number.isSafeInteger(now) ||
      now < 0
    ) {
      throw new JobFileError("INVALID_REQUEST");
    }
    const active = new Set(this.#stagingByJob.values());
    const entries = await readdir(this.#staging, { withFileTypes: true });
    let removed = 0;
    for (const entry of entries) {
      const path = join(this.#staging, entry.name);
      if (!JOB_ID.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) {
        throw new Error("JOB_ROOT_UNSAFE");
      }
      if (active.has(path)) continue;
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("JOB_ROOT_UNSAFE");
      if (info.mtimeMs <= now - maxAgeMs) {
        await rm(path, { recursive: true, force: true });
        removed += 1;
      }
    }
    if (removed > 0) await syncDirectory(this.#staging);
    return removed;
  }

  async promoteResult(input: PromoteResultInput): Promise<void> {
    if (
      input === null ||
      typeof input !== "object" ||
      typeof input.jobId !== "string" ||
      !JOB_ID.test(input.jobId) ||
      !Number.isSafeInteger(input.resultBytes) ||
      input.resultBytes < 0 ||
      input.resultBytes > MAX_INPUT_BYTES ||
      input.source === null ||
      typeof input.source !== "object"
    ) {
      throw new JobFileError("INVALID_REQUEST");
    }
    const runningParent = join(this.#root, "running");
    const runningDirectory = join(runningParent, input.jobId);
    const outboxDirectory = join(this.#outbox, input.jobId);
    try {
      await rename(join(this.#root, "queued", input.jobId), runningDirectory);
      await syncDirectory(this.#queued);
      await syncDirectory(runningParent);
    } catch {
      const info = await lstat(runningDirectory).catch(() => undefined);
      if (!info?.isDirectory() || info.isSymbolicLink()) throw new JobFileError("INVALID_REQUEST");
    }
    const temporaryResult = join(runningDirectory, `result-${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporaryResult, "wx", 0o600);
      let actual = 0;
      for await (const chunk of input.source) {
        if (input.signal?.aborted || !(chunk instanceof Uint8Array)) {
          throw new JobFileError("INVALID_REQUEST");
        }
        actual += chunk.byteLength;
        if (actual > input.resultBytes || actual > MAX_INPUT_BYTES) {
          throw new JobFileError("INVALID_REQUEST");
        }
        await writeAll(handle, chunk);
      }
      if (actual !== input.resultBytes || input.signal?.aborted) {
        throw new JobFileError("INVALID_REQUEST");
      }
      await handle.sync();
      await handle.close();
      handle = undefined;
      this.#grantWorker(temporaryResult, false);
      await rename(temporaryResult, join(runningDirectory, "result.bin"));
      await syncDirectory(runningDirectory);
      await rename(runningDirectory, outboxDirectory);
      await syncDirectory(runningParent);
      await syncDirectory(this.#outbox);
      await this.publishResult({ jobId: input.jobId, resultBytes: input.resultBytes });
    } catch (error) {
      try {
        await handle?.close();
      } catch {
        // Preserve the fixed worker boundary error.
      }
      await rm(temporaryResult, { force: true });
      if (error instanceof JobFileError) throw error;
      throw new JobFileError("INVALID_REQUEST");
    }
  }

  queuedDirectory(jobId: string): string {
    if (!JOB_ID.test(jobId)) throw new JobFileError("INVALID_REQUEST");
    return join(this.#queued, jobId);
  }

  outboxDirectory(jobId: string): string {
    if (!JOB_ID.test(jobId)) throw new JobFileError("INVALID_REQUEST");
    return join(this.#outbox, jobId);
  }

  async publishResult(input: PublishResultInput): Promise<void> {
    if (
      input === null ||
      typeof input !== "object" ||
      typeof input.jobId !== "string" ||
      !JOB_ID.test(input.jobId) ||
      !Number.isSafeInteger(input.resultBytes) ||
      input.resultBytes < 0 ||
      input.resultBytes > MAX_INPUT_BYTES
    ) {
      throw new JobFileError("INVALID_REQUEST");
    }
    const jobId = input.jobId;
    const expectedBytes = input.resultBytes;
    const claimedDirectory = join(this.#staging, jobId);
    const outboxDirectory = join(this.#outbox, jobId);
    const doneDirectory = join(this.#done, jobId);

    const published = await this.openResult(jobId);
    if (published) {
      try {
        if (published.size !== expectedBytes) throw new JobFileError("INVALID_REQUEST");
      } finally {
        await published.close();
      }
      await rm(claimedDirectory, { recursive: true, force: true });
      await rm(outboxDirectory, { recursive: true, force: true });
      await syncDirectory(this.#staging);
      await syncDirectory(this.#outbox);
      return;
    }

    try {
      await rename(outboxDirectory, claimedDirectory);
      await syncDirectory(this.#outbox);
      await syncDirectory(this.#staging);
    } catch {
      const claimed = await lstat(claimedDirectory).catch(() => undefined);
      if (!claimed?.isDirectory() || claimed.isSymbolicLink()) {
        throw new JobFileError("INVALID_REQUEST");
      }
    }

    const claimed = await lstat(claimedDirectory).catch(() => undefined);
    if (!claimed?.isDirectory() || claimed.isSymbolicLink()) {
      throw new JobFileError("INVALID_REQUEST");
    }
    const entries = await readdir(claimedDirectory, { withFileTypes: true });
    let resultEntry = false;
    for (const entry of entries) {
      if (
        entry.isSymbolicLink() ||
        !entry.isFile() ||
        (entry.name !== "input.bin" &&
          entry.name !== "manifest.json" &&
          entry.name !== "result.bin" &&
          entry.name !== "status.json")
      ) {
        throw new JobFileError("INVALID_REQUEST");
      }
      if (entry.name === "result.bin") resultEntry = true;
    }
    if (!resultEntry) throw new JobFileError("INVALID_REQUEST");

    const privateDirectory = join(this.#staging, randomUUID());
    let sourceHandle: Awaited<ReturnType<typeof open>> | undefined;
    let destinationHandle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      sourceHandle = await open(
        join(claimedDirectory, "result.bin"),
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
      );
      const sourceInfo = await sourceHandle.stat();
      if (
        !sourceInfo.isFile() ||
        sourceInfo.size !== expectedBytes ||
        (sourceInfo.mode & 0o007) !== 0
      ) {
        throw new JobFileError("INVALID_REQUEST");
      }
      await mkdir(privateDirectory, { mode: 0o700 });
      destinationHandle = await open(join(privateDirectory, "result.bin"), "wx", 0o600);
      const buffer = Buffer.alloc(64 * 1024);
      let copied = 0;
      while (copied < expectedBytes) {
        const read = await sourceHandle.read(
          buffer,
          0,
          Math.min(buffer.byteLength, expectedBytes - copied),
          copied,
        );
        if (read.bytesRead < 1) throw new JobFileError("INVALID_REQUEST");
        await writeAll(destinationHandle, buffer.subarray(0, read.bytesRead));
        copied += read.bytesRead;
      }
      const extra = await sourceHandle.read(buffer, 0, 1, copied);
      if (extra.bytesRead !== 0) throw new JobFileError("INVALID_REQUEST");
      await destinationHandle.sync();
      await destinationHandle.close();
      destinationHandle = undefined;
      await sourceHandle.close();
      sourceHandle = undefined;
      const destinationInfo = await lstat(join(privateDirectory, "result.bin"));
      if (
        !destinationInfo.isFile() ||
        destinationInfo.isSymbolicLink() ||
        destinationInfo.size !== expectedBytes ||
        (destinationInfo.mode & 0o777) !== 0o600
      ) {
        throw new JobFileError("INVALID_REQUEST");
      }
      await syncDirectory(privateDirectory);
      await rename(privateDirectory, doneDirectory);
      await syncDirectory(this.#staging);
      await syncDirectory(this.#done);
      await rm(claimedDirectory, { recursive: true, force: true });
      await syncDirectory(this.#staging);
    } catch (error) {
      try {
        await destinationHandle?.close();
      } catch {
        // Preserve the fixed publication failure.
      }
      try {
        await sourceHandle?.close();
      } catch {
        // Preserve the fixed publication failure.
      }
      await rm(privateDirectory, { recursive: true, force: true });
      if (error instanceof JobFileError) throw error;
      throw new JobFileError("INVALID_REQUEST");
    }
  }

  resultPath(jobId: string): string {
    if (!JOB_ID.test(jobId)) throw new JobFileError("INVALID_REQUEST");
    return join(this.#done, jobId, "result.bin");
  }

  async resultSize(jobId: string): Promise<number | undefined> {
    try {
      const info = await lstat(this.resultPath(jobId));
      if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o007) !== 0) return undefined;
      return info.size;
    } catch {
      return undefined;
    }
  }

  async openResult(jobId: string): Promise<OpenedJobResult | undefined> {
    if (!JOB_ID.test(jobId)) return undefined;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(this.resultPath(jobId), fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      const info = await handle.stat();
      if (!info.isFile() || (info.mode & 0o007) !== 0) {
        await handle.close();
        return undefined;
      }
      const ownedHandle = handle;
      const stream = ownedHandle.createReadStream({ autoClose: false });
      let closed = false;
      return Object.freeze({
        close: async () => {
          if (closed) return;
          closed = true;
          stream.destroy();
          await ownedHandle.close();
        },
        size: info.size,
        stream,
      });
    } catch {
      try {
        await handle?.close();
      } catch {
        // The fixed not-ready boundary does not disclose filesystem failures.
      }
      return undefined;
    }
  }

  #grantWorker(path: string, directory: boolean): void {
    const currentGroups =
      typeof process.getgroups === "function" ? process.getgroups() : [this.#workerGid];
    const currentGid = typeof process.getgid === "function" ? process.getgid() : this.#workerGid;
    if (currentGid !== this.#workerGid && !currentGroups.includes(this.#workerGid)) {
      throw new JobFileError("INVALID_REQUEST");
    }
    const info = lstatSync(path);
    if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) {
      throw new JobFileError("INVALID_REQUEST");
    }
    if (info.gid !== this.#workerGid) chownSync(path, info.uid, this.#workerGid);
    chmodSync(path, directory ? 0o2770 : 0o640);
  }

  #grantWorkerTraversal(path: string): void {
    const currentGroups =
      typeof process.getgroups === "function" ? process.getgroups() : [this.#workerGid];
    const currentGid = typeof process.getgid === "function" ? process.getgid() : this.#workerGid;
    if (currentGid !== this.#workerGid && !currentGroups.includes(this.#workerGid)) {
      throw new JobFileError("INVALID_REQUEST");
    }
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new JobFileError("INVALID_REQUEST");
    if (info.gid !== this.#workerGid) chownSync(path, info.uid, this.#workerGid);
    chmodSync(path, 0o710);
  }
}
