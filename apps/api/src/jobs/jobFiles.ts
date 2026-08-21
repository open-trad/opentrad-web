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
  isJobResultMediaType,
  type JobErrorCode,
  jobResultMediaType,
} from "@opentrad/contracts";

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_INPUT_BYTES = 52 * 1024 * 1024;
const STATES = ["queued", "running", "outbox", "done"] as const;
const intrinsicJsonStringify = JSON.stringify;
const intrinsicJsonParse = JSON.parse;
const intrinsicArrayPush = Array.prototype.push;
const intrinsicArraySort = Array.prototype.sort;
const intrinsicGetPrototypeOf = Object.getPrototypeOf;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const intrinsicReflectApply = Reflect.apply;

export type WorkerCompletion =
  | Readonly<{
      jobId: string;
      schemaVersion: "worker-result-v1";
      status: "cancelled";
    }>
  | Readonly<{
      errorCode: "CONVERSION_FAILED";
      jobId: string;
      retryable: false;
      schemaVersion: "worker-result-v1";
      status: "failed";
    }>
  | Readonly<{
      jobId: string;
      mediaType: string;
      resultBytes: number;
      schemaVersion: "worker-result-v1";
      status: "succeeded";
    }>;

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

function completionStatus(jobId: string, input: unknown): WorkerCompletion {
  try {
    if (
      input === null ||
      typeof input !== "object" ||
      intrinsicGetPrototypeOf(input) !== intrinsicObjectPrototype
    ) {
      throw new Error();
    }
    const keys = intrinsicReflectOwnKeys(input);
    const own = (key: string): unknown => {
      const descriptor = intrinsicReflectGetOwnPropertyDescriptor(input, key);
      if (!descriptor || !("value" in descriptor)) throw new Error();
      return descriptor.value;
    };
    const schemaVersion = own("schemaVersion");
    const status = own("status");
    if (schemaVersion !== "worker-result-v1") throw new Error();
    if (status === "cancelled") {
      if (keys.length !== 2) throw new Error();
      return Object.freeze({ jobId, schemaVersion, status });
    }
    if (status === "failed") {
      const errorCode = own("errorCode");
      const retryable = own("retryable");
      if (keys.length !== 4 || errorCode !== "CONVERSION_FAILED" || retryable !== false) {
        throw new Error();
      }
      return Object.freeze({ errorCode, jobId, retryable, schemaVersion, status });
    }
    if (status === "succeeded") {
      const mediaType = own("mediaType");
      const resultBytes = own("resultBytes");
      if (
        (keys.length !== 4 && keys.length !== 6) ||
        !isJobResultMediaType(mediaType) ||
        !Number.isSafeInteger(resultBytes) ||
        (resultBytes as number) < 1 ||
        (resultBytes as number) > MAX_INPUT_BYTES
      ) {
        throw new Error();
      }
      if (keys.length === 6) {
        const pageCount = own("pageCount");
        const bodyPages = own("bodyPages");
        if (
          !Number.isSafeInteger(pageCount) ||
          (pageCount as number) < 1 ||
          (pageCount as number) > 80 ||
          !Number.isSafeInteger(bodyPages) ||
          (bodyPages as number) < 1 ||
          (bodyPages as number) > (pageCount as number)
        ) {
          throw new Error();
        }
      }
      return Object.freeze({
        jobId,
        mediaType: mediaType as string,
        resultBytes: resultBytes as number,
        schemaVersion,
        status,
      });
    }
    throw new Error();
  } catch {
    throw new JobFileError("INVALID_REQUEST");
  }
}

async function readCompletionStatus(path: string, jobId: string): Promise<WorkerCompletion> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.size < 1 || info.size > 4 * 1024 || (info.mode & 0o007) !== 0) {
      throw new JobFileError("INVALID_REQUEST");
    }
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (result.bytesRead < 1) throw new JobFileError("INVALID_REQUEST");
      offset += result.bytesRead;
    }
    const extra = Buffer.alloc(1);
    if ((await handle.read(extra, 0, 1, offset)).bytesRead !== 0) {
      throw new JobFileError("INVALID_REQUEST");
    }
    await handle.close();
    handle = undefined;
    const text = bytes.toString("utf8");
    if (!text.endsWith("\n") || text.includes("\0")) throw new JobFileError("INVALID_REQUEST");
    return completionStatus(jobId, intrinsicJsonParse(text));
  } catch (error) {
    try {
      await handle?.close();
    } catch {
      // Preserve the fixed worker completion error.
    }
    if (error instanceof JobFileError) throw error;
    throw new JobFileError("INVALID_REQUEST");
  }
}

async function readWorkerManifest(path: string, jobId: string): Promise<CreateJobRequest> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.size < 1 || info.size > 4 * 1024 || (info.mode & 0o007) !== 0) {
      throw new JobFileError("INVALID_REQUEST");
    }
    const bytes = Buffer.alloc(info.size);
    if ((await handle.read(bytes, 0, bytes.length, 0)).bytesRead !== bytes.length) {
      throw new JobFileError("INVALID_REQUEST");
    }
    await handle.close();
    handle = undefined;
    const text = bytes.toString("utf8");
    if (!text.endsWith("\n") || text.includes("\0")) throw new JobFileError("INVALID_REQUEST");
    const value = intrinsicJsonParse(text) as unknown;
    if (
      value === null ||
      typeof value !== "object" ||
      intrinsicGetPrototypeOf(value) !== intrinsicObjectPrototype
    ) {
      throw new JobFileError("INVALID_REQUEST");
    }
    const keys = intrinsicReflectOwnKeys(value);
    const expected = [
      "schemaVersion",
      "jobId",
      "operation",
      "inputFormat",
      "outputFormat",
      "options",
      "inputBytes",
    ];
    if (keys.length !== expected.length) throw new JobFileError("INVALID_REQUEST");
    for (let index = 0; index < expected.length; index += 1) {
      if (!keys.includes(expected[index] as string)) throw new JobFileError("INVALID_REQUEST");
    }
    const own = (key: string): unknown => {
      const descriptor = intrinsicReflectGetOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) throw new JobFileError("INVALID_REQUEST");
      return descriptor.value;
    };
    if (own("schemaVersion") !== "server-v1" || own("jobId") !== jobId) {
      throw new JobFileError("INVALID_REQUEST");
    }
    return CreateJobRequestSchema.parse({
      inputBytes: own("inputBytes"),
      inputFormat: own("inputFormat"),
      operation: own("operation"),
      options: own("options"),
      outputFormat: own("outputFormat"),
    });
  } catch (error) {
    try {
      await handle?.close();
    } catch {
      // Preserve the fixed worker manifest error.
    }
    if (error instanceof JobFileError) throw error;
    throw new JobFileError("INVALID_REQUEST");
  }
}

async function validateWorkerResult(
  path: string,
  completion: Extract<WorkerCompletion, { status: "succeeded" }>,
  request: CreateJobRequest,
): Promise<void> {
  if (completion.mediaType !== jobResultMediaType(request.outputFormat)) {
    throw new JobFileError("INVALID_REQUEST");
  }
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.size !== completion.resultBytes || (info.mode & 0o007) !== 0) {
      throw new JobFileError("INVALID_REQUEST");
    }
    const first = Buffer.alloc(Math.min(16, info.size));
    if ((await handle.read(first, 0, first.length, 0)).bytesRead !== first.length) {
      throw new JobFileError("INVALID_REQUEST");
    }
    const last = Buffer.alloc(Math.min(2, info.size));
    if (
      (await handle.read(last, 0, last.length, info.size - last.length)).bytesRead !== last.length
    ) {
      throw new JobFileError("INVALID_REQUEST");
    }
    const valid =
      (request.outputFormat === "pdf" && first.subarray(0, 4).equals(Buffer.from("%PDF"))) ||
      ((request.outputFormat === "docx" || request.outputFormat === "odt") &&
        first[0] === 0x50 &&
        first[1] === 0x4b) ||
      (request.outputFormat === "png" &&
        first
          .subarray(0, 8)
          .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
      (request.outputFormat === "jpg" &&
        first[0] === 0xff &&
        first[1] === 0xd8 &&
        last[0] === 0xff &&
        last[1] === 0xd9) ||
      (request.outputFormat === "csv" &&
        first[0] === 0xef &&
        first[1] === 0xbb &&
        first[2] === 0xbf) ||
      (request.outputFormat === "rtf" && first.subarray(0, 5).equals(Buffer.from("{\\rtf"))) ||
      (request.outputFormat === "html" &&
        (first[0] === 0x3c ||
          (first[0] === 0xef && first[1] === 0xbb && first[2] === 0xbf && first[3] === 0x3c))) ||
      (request.outputFormat === "webp" &&
        first.subarray(0, 4).equals(Buffer.from("RIFF")) &&
        first.subarray(8, 12).equals(Buffer.from("WEBP"))) ||
      (request.outputFormat === "avif" &&
        first.subarray(4, 8).equals(Buffer.from("ftyp")) &&
        first.subarray(8, 12).equals(Buffer.from("avif"))) ||
      request.outputFormat === "txt" ||
      request.outputFormat === "md";
    if (!valid) throw new JobFileError("INVALID_REQUEST");
    await handle.close();
  } catch (error) {
    try {
      await handle?.close();
    } catch {
      // Preserve the fixed result validation error.
    }
    if (error instanceof JobFileError) throw error;
    throw new JobFileError("INVALID_REQUEST");
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
  readonly #control: string;
  readonly #reconcile: string;
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
      this.#control = join(canonicalRoot, "control");
      this.#reconcile = join(canonicalRoot, "reconcile");
      for (const path of [
        this.#staging,
        this.#queued,
        join(canonicalRoot, "running"),
        this.#outbox,
        this.#done,
        this.#reconcile,
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
      try {
        mkdirSync(this.#control, { mode: 0o750 });
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      }
      const controlInfo = lstatSync(this.#control);
      if (
        !controlInfo.isDirectory() ||
        controlInfo.isSymbolicLink() ||
        controlInfo.uid !== effectiveUser
      ) {
        throw new Error();
      }
      if (controlInfo.gid !== this.#workerGid) {
        chownSync(this.#control, controlInfo.uid, this.#workerGid);
      }
      chmodSync(this.#control, 0o750);
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
    for (const parent of [this.#staging, this.#reconcile]) {
      try {
        const info = await lstat(join(parent, jobId));
        if (info.isDirectory() && !info.isSymbolicLink()) return true;
      } catch {
        // Continue to the finite shared and private state roots.
      }
    }
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
    await rm(join(this.#reconcile, jobId), { recursive: true, force: true });
    for (const state of STATES) {
      await rm(join(this.#root, state, jobId), { recursive: true, force: true });
    }
    await this.clearCancellation(jobId);
  }

  async cancelQueued(jobId: string): Promise<boolean> {
    if (!JOB_ID.test(jobId)) throw new JobFileError("INVALID_REQUEST");
    const source = join(this.#queued, jobId);
    const claimed = join(this.#staging, jobId);
    try {
      await rename(source, claimed);
      await syncDirectory(this.#queued);
      await syncDirectory(this.#staging);
      return true;
    } catch (error) {
      const info = await lstat(claimed).catch(() => undefined);
      if (info?.isDirectory() && !info.isSymbolicLink()) return true;
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
      throw new JobFileError("INVALID_REQUEST");
    }
  }

  async runningExists(jobId: string): Promise<boolean> {
    if (!JOB_ID.test(jobId)) throw new JobFileError("INVALID_REQUEST");
    try {
      const info = await lstat(join(this.#root, "running", jobId));
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        info.gid !== this.#workerGid ||
        (info.mode & 0o7777) !== 0o2770
      ) {
        throw new JobFileError("INVALID_REQUEST");
      }
      return true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
      if (error instanceof JobFileError) throw error;
      throw new JobFileError("INVALID_REQUEST");
    }
  }

  async requestCancellation(jobId: string): Promise<void> {
    if (!JOB_ID.test(jobId)) throw new JobFileError("INVALID_REQUEST");
    const running = join(this.#root, "running", jobId);
    const marker = join(this.#control, `${jobId}.cancel`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const directory = await lstat(running);
      if (
        !directory.isDirectory() ||
        directory.isSymbolicLink() ||
        directory.gid !== this.#workerGid ||
        (directory.mode & 0o7777) !== 0o2770
      ) {
        throw new JobFileError("INVALID_REQUEST");
      }
      try {
        handle = await open(
          marker,
          fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
          0o640,
        );
        const info = await handle.stat();
        if (
          !info.isFile() ||
          info.gid !== this.#workerGid ||
          (info.mode & 0o777) !== 0o640 ||
          info.size !== 0
        ) {
          throw new JobFileError("INVALID_REQUEST");
        }
        await handle.sync();
        await handle.close();
        handle = undefined;
        await syncDirectory(this.#control);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
        const info = await lstat(marker);
        if (
          !info.isFile() ||
          info.isSymbolicLink() ||
          info.gid !== this.#workerGid ||
          (info.mode & 0o777) !== 0o640 ||
          info.size !== 0
        ) {
          throw new JobFileError("INVALID_REQUEST");
        }
      }
    } catch (error) {
      try {
        await handle?.close();
      } catch {
        // Preserve the fixed control-plane failure.
      }
      if (error instanceof JobFileError) throw error;
      throw new JobFileError("INVALID_REQUEST");
    }
  }

  async clearCancellation(jobId: string): Promise<void> {
    if (!JOB_ID.test(jobId)) throw new JobFileError("INVALID_REQUEST");
    const marker = join(this.#control, `${jobId}.cancel`);
    try {
      const info = await lstat(marker);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.gid !== this.#workerGid ||
        (info.mode & 0o777) !== 0o640 ||
        info.size !== 0
      ) {
        throw new JobFileError("INVALID_REQUEST");
      }
      await rm(marker);
      await syncDirectory(this.#control);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      if (error instanceof JobFileError) throw error;
      throw new JobFileError("INVALID_REQUEST");
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

  async listRunningJobIds(limit = 32): Promise<readonly string[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32) {
      throw new JobFileError("INVALID_REQUEST");
    }
    try {
      const parent = join(this.#root, "running");
      const names = await readdir(parent);
      intrinsicReflectApply(intrinsicArraySort, names, []);
      const output: string[] = [];
      for (let index = 0; index < names.length && output.length < limit; index += 1) {
        const jobId = names[index];
        if (!jobId || !JOB_ID.test(jobId)) throw new JobFileError("INVALID_REQUEST");
        const info = await lstat(join(parent, jobId));
        if (!info.isDirectory() || info.isSymbolicLink()) throw new JobFileError("INVALID_REQUEST");
        intrinsicReflectApply(intrinsicArrayPush, output, [jobId]);
      }
      return Object.freeze(output);
    } catch (error) {
      if (error instanceof JobFileError) throw error;
      throw new JobFileError("INVALID_REQUEST");
    }
  }

  async listWorkerCompletionIds(limit = 32): Promise<readonly string[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32) {
      throw new JobFileError("INVALID_REQUEST");
    }
    const output: string[] = [];
    const add = (jobId: string) => {
      for (let index = 0; index < output.length; index += 1) {
        if (output[index] === jobId) return;
      }
      intrinsicReflectApply(intrinsicArrayPush, output, [jobId]);
    };
    try {
      const outbox = await readdir(this.#outbox);
      intrinsicReflectApply(intrinsicArraySort, outbox, []);
      for (let index = 0; index < outbox.length && output.length < limit; index += 1) {
        const jobId = outbox[index];
        if (!jobId || !JOB_ID.test(jobId)) throw new JobFileError("INVALID_REQUEST");
        const info = await lstat(join(this.#outbox, jobId));
        if (!info.isDirectory() || info.isSymbolicLink()) throw new JobFileError("INVALID_REQUEST");
        add(jobId);
      }
      for (const parent of [this.#reconcile, this.#done]) {
        if (output.length >= limit) break;
        const names = await readdir(parent);
        intrinsicReflectApply(intrinsicArraySort, names, []);
        for (let index = 0; index < names.length && output.length < limit; index += 1) {
          const jobId = names[index];
          if (!jobId || !JOB_ID.test(jobId)) continue;
          const status = await lstat(join(parent, jobId, "status.json")).catch(() => undefined);
          if (status?.isFile() && !status.isSymbolicLink()) add(jobId);
        }
      }
      return Object.freeze(output);
    } catch (error) {
      if (error instanceof JobFileError) throw error;
      throw new JobFileError("INVALID_REQUEST");
    }
  }

  async claimWorkerCompletion(jobId: string): Promise<WorkerCompletion> {
    if (!JOB_ID.test(jobId)) throw new JobFileError("INVALID_REQUEST");
    const publishedStatus = join(this.#done, jobId, "status.json");
    try {
      return await readCompletionStatus(publishedStatus, jobId);
    } catch {
      // Continue to an unclaimed or crash-claimed worker completion.
    }
    const claimed = join(this.#reconcile, jobId);
    const outbox = join(this.#outbox, jobId);
    try {
      const claimedInfo = await lstat(claimed).catch(() => undefined);
      if (claimedInfo === undefined) {
        await rename(outbox, claimed);
        await syncDirectory(this.#outbox);
        await syncDirectory(this.#reconcile);
      } else if (!claimedInfo.isDirectory() || claimedInfo.isSymbolicLink()) {
        throw new JobFileError("INVALID_REQUEST");
      }
      const completion = await readCompletionStatus(join(claimed, "status.json"), jobId);
      const request = await readWorkerManifest(join(claimed, "manifest.json"), jobId);
      const names = await readdir(claimed);
      intrinsicReflectApply(intrinsicArraySort, names, []);
      const expected =
        completion.status === "succeeded"
          ? ["input.bin", "manifest.json", "result.bin", "status.json"]
          : ["input.bin", "manifest.json", "status.json"];
      if (names.length !== expected.length) throw new JobFileError("INVALID_REQUEST");
      for (let index = 0; index < expected.length; index += 1) {
        if (names[index] !== expected[index]) throw new JobFileError("INVALID_REQUEST");
        const info = await lstat(join(claimed, expected[index] as string));
        if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o007) !== 0) {
          throw new JobFileError("INVALID_REQUEST");
        }
      }
      if (completion.status === "succeeded") {
        const result = await lstat(join(claimed, "result.bin"));
        if (result.size !== completion.resultBytes) throw new JobFileError("INVALID_REQUEST");
        await validateWorkerResult(join(claimed, "result.bin"), completion, request);
      }
      return completion;
    } catch (error) {
      if (error instanceof JobFileError) throw error;
      throw new JobFileError("INVALID_REQUEST");
    }
  }

  async completeWorkerReconciliation(jobId: string): Promise<void> {
    if (!JOB_ID.test(jobId)) throw new JobFileError("INVALID_REQUEST");
    await rm(join(this.#reconcile, jobId), { recursive: true, force: true });
    await rm(join(this.#done, jobId, "status.json"), { force: true });
    await this.clearCancellation(jobId);
  }

  async prepareWorkerTerminal(completion: WorkerCompletion): Promise<void> {
    if (!JOB_ID.test(completion.jobId)) throw new JobFileError("INVALID_REQUEST");
    const reconciledDirectory = join(this.#reconcile, completion.jobId);
    const doneDirectory = join(this.#done, completion.jobId);
    try {
      const reconciled = await lstat(reconciledDirectory).catch(() => undefined);
      const directory = reconciled?.isDirectory() ? reconciledDirectory : doneDirectory;
      const directoryInfo = await lstat(directory);
      if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
        throw new JobFileError("INVALID_REQUEST");
      }
      const verified = await readCompletionStatus(join(directory, "status.json"), completion.jobId);
      if (
        verified.status !== completion.status ||
        (verified.status === "succeeded" &&
          (completion.status !== "succeeded" ||
            verified.resultBytes !== completion.resultBytes ||
            verified.mediaType !== completion.mediaType))
      ) {
        throw new JobFileError("INVALID_REQUEST");
      }
      const names = await readdir(directory);
      for (let index = 0; index < names.length; index += 1) {
        const name = names[index];
        if (!name) throw new JobFileError("INVALID_REQUEST");
        if (name !== "status.json") await rm(join(directory, name), { force: true });
      }
      const remaining = await readdir(directory);
      if (remaining.length !== 1 || remaining[0] !== "status.json") {
        throw new JobFileError("INVALID_REQUEST");
      }
      await syncDirectory(directory);
      await syncDirectory(directory === reconciledDirectory ? this.#reconcile : this.#done);
    } catch (error) {
      if (error instanceof JobFileError) throw error;
      throw new JobFileError("INVALID_REQUEST");
    }
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
    const reconciledDirectory = join(this.#reconcile, jobId);
    const legacyClaimedDirectory = join(this.#staging, jobId);
    const reconciled = await lstat(reconciledDirectory).catch(() => undefined);
    const claimedDirectory = reconciled?.isDirectory()
      ? reconciledDirectory
      : legacyClaimedDirectory;
    const claimedParent = reconciled?.isDirectory() ? this.#reconcile : this.#staging;
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
      await syncDirectory(claimedParent);
      await syncDirectory(this.#outbox);
      return;
    }

    try {
      await rename(outboxDirectory, claimedDirectory);
      await syncDirectory(this.#outbox);
      await syncDirectory(claimedParent);
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
      const statusPath = join(claimedDirectory, "status.json");
      const statusInfo = await lstat(statusPath).catch(() => undefined);
      if (statusInfo !== undefined) {
        const completion = await readCompletionStatus(statusPath, jobId);
        if (completion.status !== "succeeded" || completion.resultBytes !== expectedBytes) {
          throw new JobFileError("INVALID_REQUEST");
        }
        const journal = Buffer.from(
          `${intrinsicJsonStringify({
            mediaType: completion.mediaType,
            resultBytes: completion.resultBytes,
            schemaVersion: completion.schemaVersion,
            status: completion.status,
          })}\n`,
          "utf8",
        );
        const journalHandle = await open(join(privateDirectory, "status.json"), "wx", 0o600);
        try {
          await writeAll(journalHandle, journal);
          await journalHandle.sync();
        } finally {
          await journalHandle.close();
        }
      }
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
      await syncDirectory(claimedParent);
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
